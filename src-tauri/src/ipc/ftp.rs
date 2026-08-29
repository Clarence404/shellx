use crate::error::{Error, Result};
use crate::ftp::charset::Charset;
use crate::ftp::client::{FtpClient, FtpSpec, Tls};
use crate::ipc::transfer::{join_remote, rel_to_path, walk_local, DirTransferInit};
use crate::session::manager::WalkedKind;
use crate::transfer::{TransferId, TransferManager};
use std::path::PathBuf;
use crate::ftp::manager::FtpManager;
use crate::protocol::sftp_types::Entry;
use crate::protocol::{AuthConfig, AuthMethod};
use crate::session::manager::SessionManager;
use crate::settings::SettingsStore;
use crate::store::{
    FtpHost, FtpHostStore, FtpHostUpdate, HostStore, KeychainStore, NewFtpHost,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, State};
use uuid::Uuid;

// ------------------------------------------------------ saved connections

#[derive(Deserialize)]
pub struct SaveFtpHostArgs {
    #[serde(flatten)]
    pub host: NewFtpHost,
    /// Routed to the keychain, never to the database.
    pub password: Option<String>,
    /// Likewise, for an encrypted private key.
    pub passphrase: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpHostSaveResult {
    #[serde(flatten)]
    pub host: FtpHost,
    pub password_stored: bool,
}

#[derive(Deserialize)]
pub struct UpdateFtpHostArgs {
    pub id: Uuid,
    #[serde(flatten)]
    pub patch: FtpHostUpdate,
    pub password: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Deserialize)]
pub struct IdArgs {
    pub id: Uuid,
}

#[tauri::command]
pub async fn ftp_host_list(
    store: State<'_, FtpHostStore>,
) -> Result<Vec<FtpHost>> {
    store.list().await
}

#[tauri::command]
pub async fn ftp_host_save(
    args: SaveFtpHostArgs,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
) -> Result<FtpHostSaveResult> {
    let host = store.insert(args.host).await?;
    let password_stored = store_password(&keychain, host.id, args.password.as_deref());
    store_passphrase(&keychain, host.id, args.passphrase.as_deref());
    crate::log_info!(
        crate::logs::categories::HOST,
        "FTP-view connection saved",
        "host_id": host.id.to_string(),
        "protocol": host.protocol,
    );
    Ok(FtpHostSaveResult { host, password_stored })
}

#[tauri::command]
pub async fn ftp_host_update(
    args: UpdateFtpHostArgs,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
) -> Result<FtpHostSaveResult> {
    let host = store.update(args.id, args.patch).await?;
    let password_stored = store_password(&keychain, host.id, args.password.as_deref());
    store_passphrase(&keychain, host.id, args.passphrase.as_deref());
    Ok(FtpHostSaveResult { host, password_stored })
}

#[tauri::command]
pub async fn ftp_host_delete(
    args: IdArgs,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
    ftp: State<'_, FtpManager>,
) -> Result<()> {
    // Drop the live connection first: a row whose password is about to
    // leave the keychain has no business still being connected.
    ftp.close(args.id).await;
    store.delete(args.id).await?;
    let _ = keychain.delete_password(args.id);
    let _ = keychain.delete_passphrase(args.id);
    crate::log_info!(
        crate::logs::categories::HOST,
        "FTP-view connection deleted",
        "host_id": args.id.to_string(),
    );
    Ok(())
}

/// These rows have their own ids, so their keychain accounts never
/// collide with a saved SSH host's — the same machine can appear in both
/// lists under different credentials.
fn store_passphrase(keychain: &KeychainStore, id: Uuid, passphrase: Option<&str>) {
    if let Some(p) = passphrase.filter(|p| !p.is_empty()) {
        if let Err(e) = keychain.set_passphrase(id, p) {
            crate::log_warn!(
                crate::logs::categories::KEYCHAIN,
                "could not store FTP-view key passphrase",
                "host_id": id.to_string(),
                "error": e.to_string(),
            );
        }
    }
}

fn store_password(keychain: &KeychainStore, id: Uuid, password: Option<&str>) -> bool {
    match password {
        Some(p) if !p.is_empty() => match keychain.set_password(id, p) {
            Ok(()) => true,
            Err(e) => {
                crate::log_warn!(
                    crate::logs::categories::KEYCHAIN,
                    "could not store FTP-view connection password",
                    "host_id": id.to_string(),
                    "error": e.to_string(),
                );
                false
            }
        },
        _ => false,
    }
}


/// Same rule the sftp commands follow: a browsing operation is one
/// request and one reply, so a deadline turns a wedged connection into
/// an error instead of a forever-pending promise.
const BROWSE_DEADLINE: std::time::Duration = std::time::Duration::from_secs(30);

async fn deadline<T>(
    what: &str,
    fut: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    match tokio::time::timeout(BROWSE_DEADLINE, fut).await {
        Ok(r) => r,
        Err(_) => Err(Error::Protocol(format!(
            "{what} timed out — the connection may be dead; reconnect and try again"
        ))),
    }
}

// ------------------------------------------------------- live connections

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpConnected {
    pub id: Uuid,
    /// Where the server dropped us, which is where the pane opens.
    pub cwd: String,
}

#[derive(Deserialize)]
pub struct FtpConnectArgs {
    pub id: Uuid,
    /// Only when the keychain has nothing stored — a prompt filled in by
    /// the user for this connection alone.
    pub password: Option<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ftp_connect(
    args: FtpConnectArgs,
    app: AppHandle,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
    settings: State<'_, SettingsStore>,
) -> Result<FtpConnected> {
    let host = store
        .get(args.id)
        .await?
        .ok_or_else(|| Error::Protocol(format!("no FTP-view connection {}", args.id)))?;

    let password = match args.password {
        Some(p) => p,
        None => keychain
            .get_password(host.id)
            .unwrap_or(None)
            .unwrap_or_default(),
    };

    crate::log_info!(
        crate::logs::categories::SESSION,
        "opening file-transfer connection",
        "protocol": host.protocol,
        "host": host.host,
        "port": host.port,
        "user": host.username,
    );

    if host.protocol == "sftp" {
        return connect_sftp(&host, &password, app, &keychain, &ftp, &sessions, &settings).await;
    }

    let mut client = deadline("connect", FtpClient::connect(
        &host.host,
        host.port,
        &host.username,
        &password,
        Charset::parse(&host.charset),
        host.passive,
        Tls::parse(&host.protocol, &host.tls_mode),
    ))
    .await
    .inspect_err(|e| {
        crate::log_error!(
            crate::logs::categories::SESSION,
            "ftp connection failed",
            "host": host.host,
            "port": host.port,
            "error": e.to_string(),
        );
    })?;

    // Whatever directory the server put us in is the one to show; asking
    // beats assuming "/" on a box that chroots into an upload folder.
    let cwd = client.pwd().await.unwrap_or_else(|_| "/".to_string());
    ftp.insert(host.id, client).await;
    Ok(FtpConnected { id: host.id, cwd })
}

/// An SFTP row is an ordinary SSH connection with no shell opened on it:
/// this view has no terminal, so a shell channel would be a resource
/// nobody could see and nobody would close.
#[allow(clippy::too_many_arguments)]
async fn connect_sftp(
    host: &FtpHost,
    password: &str,
    app: AppHandle,
    keychain: &KeychainStore,
    ftp: &FtpManager,
    sessions: &SessionManager,
    settings: &SettingsStore,
) -> Result<FtpConnected> {
    let auth = if host.auth_method == "publickey" {
        let path = host
            .key_path
            .clone()
            .ok_or_else(|| Error::Protocol("key authentication needs a key file".into()))?;
        AuthConfig {
            username: host.username.clone(),
            method: AuthMethod::Key {
                path,
                passphrase: keychain.get_passphrase(host.id).unwrap_or(None),
            },
        }
    } else {
        AuthConfig {
            username: host.username.clone(),
            method: AuthMethod::Password(password.to_string()),
        }
    };

    let advanced = crate::settings::advanced_or_default(settings);
    let policy = Arc::new(crate::ipc::hostkeys::TofuPolicy { app });
    let info = deadline("connect", sessions
        .open_connection(
            &host.host,
            host.port,
            auth,
            host.label.clone(),
            None,
            policy,
            &advanced,
        ))
        .await
        .inspect_err(|e| {
            crate::log_error!(
                crate::logs::categories::SESSION,
                "sftp connection failed",
                "host": host.host,
                "port": host.port,
                "error": e.to_string(),
            );
        })?;

    let cwd = deadline("resolve path", sessions.sftp_realpath(info.id, "."))
        .await
        .unwrap_or_else(|_| "/".to_string());
    ftp.bind_sftp(host.id, info.id).await;
    crate::log_info!(
        crate::logs::categories::SESSION,
        "sftp connection established for ftp view",
        "session": info.id.to_string(),
        "host": host.host,
    );
    Ok(FtpConnected { id: host.id, cwd })
}

#[tauri::command]
pub async fn ftp_disconnect(
    args: IdArgs,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
) -> Result<()> {
    if let Some(session) = ftp.take_sftp(args.id).await {
        let _ = sessions.close(session).await;
        return Ok(());
    }
    ftp.close(args.id).await;
    Ok(())
}

#[tauri::command]
pub async fn ftp_active_ids(ftp: State<'_, FtpManager>) -> Result<Vec<Uuid>> {
    Ok(ftp.ids().await)
}

#[derive(Deserialize)]
pub struct FtpListArgs {
    pub id: Uuid,
    pub path: String,
}

/// Routed here rather than in the frontend: the view asks for a
/// directory, and which protocol answers is this layer's problem.
#[tauri::command]
pub async fn ftp_list_dir(
    args: FtpListArgs,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
) -> Result<Vec<Entry>> {
    if let Some(session) = ftp.session_of(args.id).await {
        return deadline("list directory", sessions.sftp_list_dir(session, &args.path)).await;
    }
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    deadline("list directory", client.list_dir(&args.path)).await
}

#[tauri::command]
pub async fn ftp_pwd(
    args: IdArgs,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
) -> Result<String> {
    if let Some(session) = ftp.session_of(args.id).await {
        return deadline("resolve path", sessions.sftp_realpath(session, ".")).await;
    }
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    deadline("resolve path", client.pwd()).await
}

#[derive(Deserialize)]
pub struct FtpPathArgs {
    pub id: Uuid,
    pub path: String,
}

#[tauri::command]
pub async fn ftp_mkdir(
    args: FtpPathArgs,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
) -> Result<()> {
    if let Some(session) = ftp.session_of(args.id).await {
        return deadline("new folder", sessions.sftp_mkdir(session, &args.path)).await;
    }
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    deadline("new folder", client.mkdir(&args.path)).await
}

#[derive(Deserialize)]
pub struct FtpRenameArgs {
    pub id: Uuid,
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub async fn ftp_rename(
    args: FtpRenameArgs,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
) -> Result<()> {
    if let Some(session) = ftp.session_of(args.id).await {
        return deadline("rename", sessions.sftp_rename(session, &args.from, &args.to)).await;
    }
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    deadline("rename", client.rename(&args.from, &args.to)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpRemoveArgs {
    pub id: Uuid,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn ftp_remove(
    args: FtpRemoveArgs,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
) -> Result<()> {
    if let Some(session) = ftp.session_of(args.id).await {
        return if args.is_dir {
            sessions.sftp_remove_dir(session, &args.path).await
        } else {
            sessions.sftp_remove_file(session, &args.path).await
        };
    }
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    if args.is_dir {
        client.remove_dir(&args.path).await
    } else {
        client.remove_file(&args.path).await
    }
}

/// Connection parameters for a transfer task, with the password pulled
/// from the keychain. Built here so the spec never leaves the Rust side.
async fn spec_for(
    store: &FtpHostStore,
    keychain: &KeychainStore,
    id: Uuid,
) -> Result<(FtpHost, FtpSpec)> {
    let host = store
        .get(id)
        .await?
        .ok_or_else(|| Error::Protocol(format!("no FTP-view connection {id}")))?;
    let spec = FtpSpec {
        host: host.host.clone(),
        port: host.port,
        username: host.username.clone(),
        password: keychain.get_password(id).unwrap_or(None).unwrap_or_default(),
        charset: Charset::parse(&host.charset),
        passive: host.passive,
        tls: Tls::parse(&host.protocol, &host.tls_mode),
    };
    Ok((host, spec))
}

fn apply_concurrency(
    transfer_mgr: &TransferManager,
    settings: &SettingsStore,
) {
    // Same knob the SFTP commands read: one queue, one limit.
    transfer_mgr.set_concurrency(
        crate::settings::advanced_or_default(settings).sftp_concurrency,
    );
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpTransferArgs {
    pub id: Uuid,
    pub local_path: String,
    pub remote_path: String,
}

/// One file, either direction decided by the command. SFTP rows go to
/// the session-backed transfer; FTP and FTPS rows get a task that opens
/// its own connection. Both land in the same queue, with the same pause,
/// cancel and progress.
#[tauri::command]
pub async fn ftp_upload(
    args: FtpTransferArgs,
    app: AppHandle,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
    transfer_mgr: State<'_, TransferManager>,
    settings: State<'_, SettingsStore>,
) -> Result<TransferId> {
    apply_concurrency(&transfer_mgr, &settings);
    if let Some(session) = ftp.session_of(args.id).await {
        return Ok(transfer_mgr
            .start_upload(
                app,
                (*sessions).clone(),
                session,
                PathBuf::from(args.local_path),
                args.remote_path,
                None,
            )
            .await);
    }
    let (_, spec) = spec_for(&store, &keychain, args.id).await?;
    Ok(transfer_mgr
        .start_ftp_upload(
            app,
            spec,
            args.id,
            PathBuf::from(args.local_path),
            args.remote_path,
            None,
        )
        .await)
}

#[tauri::command]
pub async fn ftp_download(
    args: FtpTransferArgs,
    app: AppHandle,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
    transfer_mgr: State<'_, TransferManager>,
    settings: State<'_, SettingsStore>,
) -> Result<TransferId> {
    apply_concurrency(&transfer_mgr, &settings);
    if let Some(session) = ftp.session_of(args.id).await {
        return Ok(transfer_mgr
            .start_download(
                app,
                (*sessions).clone(),
                session,
                args.remote_path,
                PathBuf::from(args.local_path),
                None,
            )
            .await);
    }
    let (_, spec) = spec_for(&store, &keychain, args.id).await?;
    Ok(transfer_mgr
        .start_ftp_download(
            app,
            spec,
            args.id,
            args.remote_path,
            PathBuf::from(args.local_path),
            None,
        )
        .await)
}

/// Recursive remote walk over the live browsing connection: `(rel_path,
/// size)` for files, plus every subdirectory parents-first. The listing
/// connection is only held while enumerating — the transfers themselves
/// each open their own.
async fn walk_remote_ftp(
    ftp: &FtpManager,
    id: Uuid,
    root: &str,
) -> Result<(Vec<String>, Vec<(String, u64)>)> {
    let client = ftp.get(id).await?;
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let mut stack: Vec<String> = vec![String::new()];
    while let Some(rel) = stack.pop() {
        let abs = if rel.is_empty() { root.to_string() } else { join_remote(root, &rel) };
        let entries = client.lock().await.list_dir(&abs).await?;
        for e in entries {
            let child = if rel.is_empty() { e.name.clone() } else { format!("{rel}/{}", e.name) };
            match e.kind {
                crate::protocol::sftp_types::EntryKind::Directory => {
                    dirs.push(child.clone());
                    stack.push(child);
                }
                crate::protocol::sftp_types::EntryKind::File => files.push((child, e.size)),
                // Symlinks and oddities are skipped rather than guessed
                // at — following FTP symlinks invites cycles.
                _ => {}
            }
        }
    }
    dirs.sort_by_key(|d| d.matches('/').count());
    Ok((dirs, files))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FtpDirTransferArgs {
    pub id: Uuid,
    pub local_dir: String,
    pub remote_dir: String,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ftp_upload_dir(
    args: FtpDirTransferArgs,
    app: AppHandle,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
    transfer_mgr: State<'_, TransferManager>,
    settings: State<'_, SettingsStore>,
) -> Result<DirTransferInit> {
    apply_concurrency(&transfer_mgr, &settings);
    let group_id = Uuid::new_v4();
    let local_root = PathBuf::from(&args.local_dir);
    let (dirs, files) = walk_local(&local_root).await?;

    let sftp_session = ftp.session_of(args.id).await;
    let spec = match sftp_session {
        Some(_) => None,
        None => Some(spec_for(&store, &keychain, args.id).await?.1),
    };

    // Destination root and subdirectories parents-first, over whichever
    // channel this row browses with.
    match sftp_session {
        Some(session) => {
            let _ = sessions.sftp_mkdir(session, &args.remote_dir).await;
            for d in &dirs {
                if transfer_mgr.is_group_cancelled(group_id).await {
                    return Ok(DirTransferInit {
                        group_id, file_count: 0, transfer_ids: vec![], total_bytes: 0,
                    });
                }
                let _ = sessions.sftp_mkdir(session, &join_remote(&args.remote_dir, d)).await;
            }
        }
        None => {
            let client = ftp.get(args.id).await?;
            let _ = client.lock().await.mkdir(&args.remote_dir).await;
            for d in &dirs {
                if transfer_mgr.is_group_cancelled(group_id).await {
                    return Ok(DirTransferInit {
                        group_id, file_count: 0, transfer_ids: vec![], total_bytes: 0,
                    });
                }
                let _ = client.lock().await.mkdir(&join_remote(&args.remote_dir, d)).await;
            }
        }
    }

    let mut ids = Vec::with_capacity(files.len());
    let mut total_bytes = 0u64;
    for (rel, size) in files {
        if transfer_mgr.is_group_cancelled(group_id).await {
            break;
        }
        let local_abs = local_root.join(rel_to_path(&rel));
        let remote_abs = join_remote(&args.remote_dir, &rel);
        let id = match (sftp_session, &spec) {
            (Some(session), _) => transfer_mgr
                .start_upload(
                    app.clone(), (*sessions).clone(), session,
                    local_abs, remote_abs, Some(group_id),
                )
                .await,
            (None, Some(spec)) => transfer_mgr
                .start_ftp_upload(
                    app.clone(), spec.clone(), args.id,
                    local_abs, remote_abs, Some(group_id),
                )
                .await,
            (None, None) => unreachable!("spec built for every non-sftp row"),
        };
        ids.push(id);
        total_bytes += size;
    }

    Ok(DirTransferInit { group_id, file_count: ids.len(), transfer_ids: ids, total_bytes })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ftp_download_dir(
    args: FtpDirTransferArgs,
    app: AppHandle,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
    transfer_mgr: State<'_, TransferManager>,
    settings: State<'_, SettingsStore>,
) -> Result<DirTransferInit> {
    apply_concurrency(&transfer_mgr, &settings);
    let group_id = Uuid::new_v4();
    let local_root = PathBuf::from(&args.local_dir);
    tokio::fs::create_dir_all(&local_root).await.map_err(Error::Io)?;

    let sftp_session = ftp.session_of(args.id).await;

    // Enumerate over the browsing channel; mirror directories locally.
    let (dirs, files) = match sftp_session {
        Some(session) => {
            let walked = sessions.sftp_walk_dir(session, &args.remote_dir).await?;
            let mut dirs = Vec::new();
            let mut files = Vec::new();
            for e in walked {
                match e.kind {
                    WalkedKind::Directory => dirs.push(e.rel_path),
                    WalkedKind::File => files.push((e.rel_path, e.size)),
                }
            }
            (dirs, files)
        }
        None => walk_remote_ftp(&ftp, args.id, &args.remote_dir).await?,
    };

    for d in &dirs {
        if transfer_mgr.is_group_cancelled(group_id).await {
            return Ok(DirTransferInit {
                group_id, file_count: 0, transfer_ids: vec![], total_bytes: 0,
            });
        }
        tokio::fs::create_dir_all(local_root.join(rel_to_path(d)))
            .await
            .map_err(Error::Io)?;
    }

    let spec = match sftp_session {
        Some(_) => None,
        None => Some(spec_for(&store, &keychain, args.id).await?.1),
    };

    let mut ids = Vec::with_capacity(files.len());
    let mut total_bytes = 0u64;
    for (rel, size) in files {
        if transfer_mgr.is_group_cancelled(group_id).await {
            break;
        }
        let remote_abs = join_remote(&args.remote_dir, &rel);
        let local_abs = local_root.join(rel_to_path(&rel));
        let id = match (sftp_session, &spec) {
            (Some(session), _) => transfer_mgr
                .start_download(
                    app.clone(), (*sessions).clone(), session,
                    remote_abs, local_abs, Some(group_id),
                )
                .await,
            (None, Some(spec)) => transfer_mgr
                .start_ftp_download(
                    app.clone(), spec.clone(), args.id,
                    remote_abs, local_abs, Some(group_id),
                )
                .await,
            (None, None) => unreachable!("spec built for every non-sftp row"),
        };
        ids.push(id);
        total_bytes += size;
    }

    Ok(DirTransferInit { group_id, file_count: ids.len(), transfer_ids: ids, total_bytes })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryArgs {
    pub transfer_id: Uuid,
}

/// Queues a failed transfer again, with the same endpoints. Which
/// protocol carries it is re-derived from the connection id — a live
/// SSH session means SFTP, an FTP-view row means a fresh FTP task —
/// so this one command serves every surface that shows the queue.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn transfer_retry(
    args: RetryArgs,
    app: AppHandle,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
    transfer_mgr: State<'_, TransferManager>,
    settings: State<'_, SettingsStore>,
) -> Result<TransferId> {
    let info = transfer_mgr
        .info(args.transfer_id)
        .await
        .ok_or_else(|| Error::Protocol("that transfer is gone".into()))?;
    apply_concurrency(&transfer_mgr, &settings);
    // The old row leaves as the new one arrives — two rows for one file
    // would double-count the totals.
    transfer_mgr.remove_terminal(args.transfer_id).await;

    let upload = matches!(info.direction, crate::transfer::Direction::Upload);
    let local = PathBuf::from(&info.local_path);

    // An SFTP session id resolves through the session manager; anything
    // else must be an FTP-view row.
    if sessions.list().await.iter().any(|s| s.id == info.connection_id) {
        return Ok(if upload {
            transfer_mgr
                .start_upload(app, (*sessions).clone(), info.connection_id, local, info.remote_path, info.group_id)
                .await
        } else {
            transfer_mgr
                .start_download(app, (*sessions).clone(), info.connection_id, info.remote_path, local, info.group_id)
                .await
        });
    }
    let (_, spec) = spec_for(&store, &keychain, info.connection_id).await?;
    Ok(if upload {
        transfer_mgr
            .start_ftp_upload(app, spec, info.connection_id, local, info.remote_path, info.group_id)
            .await
    } else {
        transfer_mgr
            .start_ftp_download(app, spec, info.connection_id, info.remote_path, local, info.group_id)
            .await
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportArgs {
    /// Ids from the saved-hosts list.
    pub host_ids: Vec<Uuid>,
}

/// Copies saved SSH hosts in as SFTP rows, secrets included — the
/// password and passphrase are moved keychain-to-keychain here so they
/// never travel through the frontend to be copied.
#[tauri::command]
pub async fn ftp_host_import(
    args: ImportArgs,
    hosts: State<'_, HostStore>,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
) -> Result<Vec<FtpHost>> {
    let saved = hosts.list().await?;
    let mut created = Vec::new();
    for id in args.host_ids {
        let Some(h) = saved.iter().find(|h| h.id == id) else { continue };
        let row = store
            .insert(NewFtpHost {
                label: h.label.clone(),
                protocol: "sftp".into(),
                host: h.host.clone(),
                port: h.port,
                username: h.username.clone(),
                charset: None,
                passive: None,
                auth_method: Some(h.auth_method.clone()),
                key_path: h.key_path.clone(),
                tls_mode: None,
            })
            .await?;
        if let Ok(Some(p)) = keychain.get_password(h.id) {
            let _ = keychain.set_password(row.id, &p);
        }
        if let Ok(Some(p)) = keychain.get_passphrase(h.id) {
            let _ = keychain.set_passphrase(row.id, &p);
        }
        created.push(row);
    }
    crate::log_info!(
        crate::logs::categories::HOST,
        "imported saved hosts into the FTP view",
        "count": created.len(),
    );
    Ok(created)
}

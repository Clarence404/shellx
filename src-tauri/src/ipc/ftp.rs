use crate::error::{Error, Result};
use crate::ftp::charset::Charset;
use crate::ftp::client::{FtpClient, Tls};
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

    let mut client = FtpClient::connect(
        &host.host,
        host.port,
        &host.username,
        &password,
        Charset::parse(&host.charset),
        host.passive,
        Tls::parse(&host.protocol, &host.tls_mode),
    )
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
    let info = sessions
        .open_connection(
            &host.host,
            host.port,
            auth,
            host.label.clone(),
            None,
            policy,
            &advanced,
        )
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

    let cwd = sessions
        .sftp_realpath(info.id, ".")
        .await
        .unwrap_or_else(|_| "/".to_string());
    ftp.bind_sftp(host.id, info.id).await;
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
        return sessions.sftp_list_dir(session, &args.path).await;
    }
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    client.list_dir(&args.path).await
}

#[tauri::command]
pub async fn ftp_pwd(
    args: IdArgs,
    ftp: State<'_, FtpManager>,
    sessions: State<'_, SessionManager>,
) -> Result<String> {
    if let Some(session) = ftp.session_of(args.id).await {
        return sessions.sftp_realpath(session, ".").await;
    }
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    client.pwd().await
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
        return sessions.sftp_mkdir(session, &args.path).await;
    }
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    client.mkdir(&args.path).await
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
        return sessions.sftp_rename(session, &args.from, &args.to).await;
    }
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    client.rename(&args.from, &args.to).await
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

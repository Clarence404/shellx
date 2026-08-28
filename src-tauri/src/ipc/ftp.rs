use crate::error::{Error, Result};
use crate::ftp::charset::Charset;
use crate::ftp::client::FtpClient;
use crate::ftp::manager::FtpManager;
use crate::protocol::sftp_types::Entry;
use crate::store::{
    KeychainStore, NewFtpHost, FtpHost, FtpHostStore, FtpHostUpdate,
};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

// ------------------------------------------------------ saved connections

#[derive(Deserialize)]
pub struct SaveFtpHostArgs {
    #[serde(flatten)]
    pub host: NewFtpHost,
    /// Routed to the keychain, never to the database.
    pub password: Option<String>,
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
pub async fn ftp_connect(
    args: FtpConnectArgs,
    store: State<'_, FtpHostStore>,
    keychain: State<'_, KeychainStore>,
    ftp: State<'_, FtpManager>,
) -> Result<FtpConnected> {
    let host = store
        .get(args.id)
        .await?
        .ok_or_else(|| Error::Protocol(format!("no FTP-view connection {}", args.id)))?;
    if host.protocol != "ftp" {
        return Err(Error::Protocol(format!(
            "{} is not supported yet in this build",
            host.protocol.to_uppercase()
        )));
    }

    let password = match args.password {
        Some(p) => p,
        None => keychain
            .get_password(host.id)
            .unwrap_or(None)
            .unwrap_or_default(),
    };

    crate::log_info!(
        crate::logs::categories::SESSION,
        "opening ftp connection",
        "host": host.host,
        "port": host.port,
        "user": host.username,
        "charset": host.charset,
        "passive": host.passive,
    );

    let mut client = FtpClient::connect(
        &host.host,
        host.port,
        &host.username,
        &password,
        Charset::parse(&host.charset),
        host.passive,
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

#[tauri::command]
pub async fn ftp_disconnect(args: IdArgs, ftp: State<'_, FtpManager>) -> Result<()> {
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

#[tauri::command]
pub async fn ftp_list_dir(args: FtpListArgs, ftp: State<'_, FtpManager>) -> Result<Vec<Entry>> {
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    client.list_dir(&args.path).await
}

#[tauri::command]
pub async fn ftp_pwd(args: IdArgs, ftp: State<'_, FtpManager>) -> Result<String> {
    let client = ftp.get(args.id).await?;
    let mut client = client.lock().await;
    client.pwd().await
}

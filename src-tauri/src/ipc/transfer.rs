//! Tauri IPC surface for SFTP file transfers. `sftp_upload`/`sftp_download`
//! hand a cheap `SessionManager` clone (its fields are already
//! `Arc<Mutex<...>>`, see `session/manager.rs`'s doc comment) into
//! `TransferManager::start_upload`/`start_download`, which spawns the
//! actual byte-pumping task; `transfer_list`/`transfer_cancel` proxy
//! directly to the manager.

use crate::error::Result;
use crate::session::{manager::SessionManager, ConnectionId};
use crate::transfer::{TransferId, TransferInfo, TransferManager};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[derive(Deserialize)]
pub struct UploadArgs {
    pub conn_id: ConnectionId,
    pub local_path: String,
    pub remote_path: String,
}

#[tauri::command]
pub async fn sftp_upload(
    args: UploadArgs,
    app: AppHandle,
    session_mgr: State<'_, SessionManager>,
    transfer_mgr: State<'_, TransferManager>,
) -> Result<TransferId> {
    let session_mgr = (*session_mgr).clone();
    Ok(transfer_mgr
        .start_upload(
            app,
            session_mgr,
            args.conn_id,
            PathBuf::from(args.local_path),
            args.remote_path,
        )
        .await)
}

#[derive(Deserialize)]
pub struct DownloadArgs {
    pub conn_id: ConnectionId,
    pub remote_path: String,
    pub local_path: String,
}

#[tauri::command]
pub async fn sftp_download(
    args: DownloadArgs,
    app: AppHandle,
    session_mgr: State<'_, SessionManager>,
    transfer_mgr: State<'_, TransferManager>,
) -> Result<TransferId> {
    let session_mgr = (*session_mgr).clone();
    Ok(transfer_mgr
        .start_download(
            app,
            session_mgr,
            args.conn_id,
            args.remote_path,
            PathBuf::from(args.local_path),
        )
        .await)
}

#[tauri::command]
pub async fn transfer_list(transfer_mgr: State<'_, TransferManager>) -> Result<Vec<TransferInfo>> {
    Ok(transfer_mgr.list().await)
}

#[derive(Deserialize)]
pub struct CancelArgs {
    pub transfer_id: TransferId,
}

#[tauri::command]
pub async fn transfer_cancel(
    args: CancelArgs,
    transfer_mgr: State<'_, TransferManager>,
) -> Result<()> {
    transfer_mgr.cancel(args.transfer_id).await
}

//! Tauri IPC surface for SFTP CRUD operations. Each command is a thin
//! wrapper around the corresponding `SessionManager::sftp_*` delegation
//! method (see `session/manager.rs`), which lazily opens the SFTP subsystem
//! on first use per connection.

use crate::error::Result;
use crate::protocol::sftp_types::Entry;
use crate::session::{manager::SessionManager, ConnectionId};
use serde::Deserialize;
use tauri::State;

#[derive(Deserialize)]
pub struct SftpListArgs {
    pub conn_id: ConnectionId,
    pub path: String,
}

#[tauri::command]
pub async fn sftp_list_dir(
    args: SftpListArgs,
    mgr: State<'_, SessionManager>,
) -> Result<Vec<Entry>> {
    mgr.sftp_list_dir(args.conn_id, &args.path).await
}

#[derive(Deserialize)]
pub struct SftpStatArgs {
    pub conn_id: ConnectionId,
    pub path: String,
}

#[tauri::command]
pub async fn sftp_stat(args: SftpStatArgs, mgr: State<'_, SessionManager>) -> Result<Entry> {
    mgr.sftp_stat(args.conn_id, &args.path).await
}

#[derive(Deserialize)]
pub struct SftpRenameArgs {
    pub conn_id: ConnectionId,
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub async fn sftp_rename(args: SftpRenameArgs, mgr: State<'_, SessionManager>) -> Result<()> {
    mgr.sftp_rename(args.conn_id, &args.from, &args.to).await
}

#[derive(Deserialize)]
pub struct SftpRemoveFileArgs {
    pub conn_id: ConnectionId,
    pub path: String,
}

#[tauri::command]
pub async fn sftp_remove_file(
    args: SftpRemoveFileArgs,
    mgr: State<'_, SessionManager>,
) -> Result<()> {
    mgr.sftp_remove_file(args.conn_id, &args.path).await
}

#[derive(Deserialize)]
pub struct SftpRemoveDirArgs {
    pub conn_id: ConnectionId,
    pub path: String,
}

#[tauri::command]
pub async fn sftp_remove_dir(
    args: SftpRemoveDirArgs,
    mgr: State<'_, SessionManager>,
) -> Result<()> {
    mgr.sftp_remove_dir(args.conn_id, &args.path).await
}

#[derive(Deserialize)]
pub struct SftpMkdirArgs {
    pub conn_id: ConnectionId,
    pub path: String,
}

#[tauri::command]
pub async fn sftp_mkdir(args: SftpMkdirArgs, mgr: State<'_, SessionManager>) -> Result<()> {
    mgr.sftp_mkdir(args.conn_id, &args.path).await
}

#[derive(Deserialize)]
pub struct SftpRealpathArgs {
    pub conn_id: ConnectionId,
    pub path: String,
}

#[tauri::command]
pub async fn sftp_realpath(
    args: SftpRealpathArgs,
    mgr: State<'_, SessionManager>,
) -> Result<String> {
    mgr.sftp_realpath(args.conn_id, &args.path).await
}

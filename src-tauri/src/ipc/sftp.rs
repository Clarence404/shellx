//! Tauri IPC surface for SFTP CRUD operations. Each command is a thin
//! wrapper around the corresponding `SessionManager::sftp_*` delegation
//! method (see `session/manager.rs`), which lazily opens the SFTP subsystem
//! on first use per connection.
//!
//! Logging convention here: reads (list / stat / realpath) log at debug so
//! browsing doesn't drown the default info-level view, while every mutation
//! (rename, remove, mkdir) logs at info on success. Failures always log at
//! error — a file operation that didn't happen is exactly what you go to the
//! Logs panel to find.

use crate::error::Result;
use crate::logs::categories::SFTP;
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
    match mgr.sftp_list_dir(args.conn_id, &args.path).await {
        Ok(entries) => {
            crate::log_debug!(
                SFTP, "listed directory",
                "session": args.conn_id.to_string(),
                "path": args.path,
                "entries": entries.len(),
            );
            Ok(entries)
        }
        Err(e) => {
            crate::log_error!(
                SFTP, "list directory failed",
                "session": args.conn_id.to_string(),
                "path": args.path,
                "error": e.to_string(),
            );
            Err(e)
        }
    }
}

#[derive(Deserialize)]
pub struct SftpStatArgs {
    pub conn_id: ConnectionId,
    pub path: String,
}

#[tauri::command]
pub async fn sftp_stat(args: SftpStatArgs, mgr: State<'_, SessionManager>) -> Result<Entry> {
    mgr.sftp_stat(args.conn_id, &args.path).await.map_err(|e| {
        crate::log_error!(
            SFTP, "stat failed",
            "session": args.conn_id.to_string(),
            "path": args.path,
            "error": e.to_string(),
        );
        e
    })
}

#[derive(Deserialize)]
pub struct SftpRenameArgs {
    pub conn_id: ConnectionId,
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub async fn sftp_rename(args: SftpRenameArgs, mgr: State<'_, SessionManager>) -> Result<()> {
    match mgr.sftp_rename(args.conn_id, &args.from, &args.to).await {
        Ok(()) => {
            crate::log_info!(
                SFTP, "renamed remote path",
                "session": args.conn_id.to_string(),
                "from": args.from,
                "to": args.to,
            );
            Ok(())
        }
        Err(e) => {
            crate::log_error!(
                SFTP, "rename failed",
                "session": args.conn_id.to_string(),
                "from": args.from,
                "to": args.to,
                "error": e.to_string(),
            );
            Err(e)
        }
    }
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
    log_removal(
        mgr.sftp_remove_file(args.conn_id, &args.path).await,
        args.conn_id,
        &args.path,
        "file",
    )
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
    log_removal(
        mgr.sftp_remove_dir(args.conn_id, &args.path).await,
        args.conn_id,
        &args.path,
        "dir",
    )
}

/// Recursive counterpart of `sftp_remove_dir`. Walks the tree, removes
/// every file, then removes directories bottom-up, then the root itself.
/// v0.6 T1: needed once directory uploads landed — the SFTP protocol's
/// RMDIR only accepts empty dirs, so removing a freshly-uploaded folder
/// would otherwise fail on the outer sftp_remove_dir call.
#[tauri::command]
pub async fn sftp_remove_dir_recursive(
    args: SftpRemoveDirArgs,
    mgr: State<'_, SessionManager>,
) -> Result<()> {
    log_removal(
        mgr.sftp_remove_dir_recursive(args.conn_id, &args.path).await,
        args.conn_id,
        &args.path,
        "dir_recursive",
    )
}

/// Shared log tail for the three delete commands — a delete that silently
/// did nothing is the worst case for a file manager, so both outcomes are
/// recorded with the kind of target that was aimed at.
fn log_removal(
    outcome: Result<()>,
    conn_id: ConnectionId,
    path: &str,
    kind: &'static str,
) -> Result<()> {
    match outcome {
        Ok(()) => {
            crate::log_info!(
                SFTP, "removed remote path",
                "session": conn_id.to_string(),
                "path": path,
                "kind": kind,
            );
            Ok(())
        }
        Err(e) => {
            crate::log_error!(
                SFTP, "remove failed",
                "session": conn_id.to_string(),
                "path": path,
                "kind": kind,
                "error": e.to_string(),
            );
            Err(e)
        }
    }
}

#[derive(Deserialize)]
pub struct SftpMkdirArgs {
    pub conn_id: ConnectionId,
    pub path: String,
}

#[tauri::command]
pub async fn sftp_mkdir(args: SftpMkdirArgs, mgr: State<'_, SessionManager>) -> Result<()> {
    match mgr.sftp_mkdir(args.conn_id, &args.path).await {
        Ok(()) => {
            crate::log_info!(
                SFTP, "created remote directory",
                "session": args.conn_id.to_string(),
                "path": args.path,
            );
            Ok(())
        }
        Err(e) => {
            crate::log_error!(
                SFTP, "mkdir failed",
                "session": args.conn_id.to_string(),
                "path": args.path,
                "error": e.to_string(),
            );
            Err(e)
        }
    }
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
    mgr.sftp_realpath(args.conn_id, &args.path).await.map_err(|e| {
        crate::log_error!(
            SFTP, "realpath failed",
            "session": args.conn_id.to_string(),
            "path": args.path,
            "error": e.to_string(),
        );
        e
    })
}

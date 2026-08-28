//! Tauri IPC surface for SFTP file transfers. `sftp_upload`/`sftp_download`
//! hand a cheap `SessionManager` clone (its fields are already
//! `Arc<Mutex<...>>`, see `session/manager.rs`'s doc comment) into
//! `TransferManager::start_upload`/`start_download`, which spawns the
//! actual byte-pumping task; `transfer_list`/`transfer_cancel` proxy
//! directly to the manager.
//!
//! v0.6 T1: `sftp_upload_dir` / `sftp_download_dir` walk source trees and
//! spawn one per-file transfer per leaf, all sharing a `group_id` so the
//! frontend can render them as one expandable Transfers row.

use crate::error::{Error, Result};
use crate::session::manager::{SessionManager, WalkedKind};
use crate::session::ConnectionId;
use crate::transfer::{TransferId, TransferInfo, TransferManager};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use uuid::Uuid;

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
    settings: State<'_, crate::settings::SettingsStore>,
) -> Result<TransferId> {
    let session_mgr = (*session_mgr).clone();
    // Pick up the current SFTP concurrency before queueing, so a
    // change in Settings → Advanced applies to the next transfer.
    transfer_mgr.set_concurrency(
        crate::settings::advanced_or_default(&settings).sftp_concurrency,
    );
    Ok(transfer_mgr
        .start_upload(
            app,
            session_mgr,
            args.conn_id,
            PathBuf::from(args.local_path),
            args.remote_path,
            None,
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
    settings: State<'_, crate::settings::SettingsStore>,
) -> Result<TransferId> {
    let session_mgr = (*session_mgr).clone();
    // Pick up the current SFTP concurrency before queueing, so a
    // change in Settings → Advanced applies to the next transfer.
    transfer_mgr.set_concurrency(
        crate::settings::advanced_or_default(&settings).sftp_concurrency,
    );
    Ok(transfer_mgr
        .start_download(
            app,
            session_mgr,
            args.conn_id,
            args.remote_path,
            PathBuf::from(args.local_path),
            None,
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

#[tauri::command]
pub async fn transfer_pause(
    args: CancelArgs,
    app: AppHandle,
    transfer_mgr: State<'_, TransferManager>,
) -> Result<()> {
    transfer_mgr.pause(app, args.transfer_id).await
}

#[derive(Deserialize)]
pub struct CancelGroupArgs {
    pub group_id: TransferId,
}

#[tauri::command]
pub async fn transfer_cancel_group(
    args: CancelGroupArgs,
    transfer_mgr: State<'_, TransferManager>,
) -> Result<()> {
    transfer_mgr.cancel_group(args.group_id).await
}

#[tauri::command]
pub async fn transfer_resume(
    args: CancelArgs,
    app: AppHandle,
    transfer_mgr: State<'_, TransferManager>,
) -> Result<()> {
    transfer_mgr.resume(app, args.transfer_id).await
}

// ---------- v0.6 T1: recursive directory transfers ----------

#[derive(Deserialize)]
pub struct UploadDirArgs {
    pub conn_id: ConnectionId,
    pub local_dir: String,
    pub remote_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirTransferInit {
    pub group_id: TransferId,
    pub transfer_ids: Vec<TransferId>,
    pub file_count: usize,
    pub total_bytes: u64,
}

#[tauri::command]
pub async fn sftp_upload_dir(
    args: UploadDirArgs,
    app: AppHandle,
    session_mgr: State<'_, SessionManager>,
    transfer_mgr: State<'_, TransferManager>,
    settings: State<'_, crate::settings::SettingsStore>,
) -> Result<DirTransferInit> {
    let session_mgr = (*session_mgr).clone();
    // Pick up the current SFTP concurrency before queueing, so a
    // change in Settings → Advanced applies to the next transfer.
    transfer_mgr.set_concurrency(
        crate::settings::advanced_or_default(&settings).sftp_concurrency,
    );
    let local_root = PathBuf::from(&args.local_dir);
    let group_id = Uuid::new_v4();

    // Local walk: collect subdirs (for mkdir) + files (for transfer). Both
    // returned as forward-slash relative paths so `join_remote` composes
    // them cleanly regardless of the host OS's separator.
    let (dirs, files) = walk_local(&local_root).await?;

    // Ensure the remote destination root exists — the caller may drop a
    // brand-new folder into a remote directory that doesn't yet contain
    // that basename. `mkdir` on an existing directory is a silent error we
    // ignore; a real mkdir failure surfaces on the first file transfer.
    let _ = session_mgr
        .sftp_mkdir(args.conn_id, &args.remote_dir)
        .await;

    // Create subdirectories parent-first so per-file uploads never race to
    // create a common ancestor. `walk_local` already sorts dirs by depth.
    for d in &dirs {
        if transfer_mgr.is_group_cancelled(group_id).await {
            return Ok(DirTransferInit {
                group_id, file_count: 0, transfer_ids: vec![], total_bytes: 0,
            });
        }
        let remote_sub = join_remote(&args.remote_dir, d);
        let _ = session_mgr.sftp_mkdir(args.conn_id, &remote_sub).await;
    }

    let mut ids = Vec::with_capacity(files.len());
    let mut total_bytes: u64 = 0;
    for (rel, size) in files {
        // The user might cancel the group mid-enumeration on a huge
        // directory (2 500+ files spawn takes multiple seconds).
        // Break early so no additional children get registered.
        if transfer_mgr.is_group_cancelled(group_id).await {
            break;
        }
        let local_abs = local_root.join(rel_to_path(&rel));
        let remote_abs = join_remote(&args.remote_dir, &rel);
        let id = transfer_mgr
            .start_upload(
                app.clone(),
                session_mgr.clone(),
                args.conn_id,
                local_abs,
                remote_abs,
                Some(group_id),
            )
            .await;
        ids.push(id);
        total_bytes += size;
    }

    Ok(DirTransferInit {
        group_id,
        file_count: ids.len(),
        transfer_ids: ids,
        total_bytes,
    })
}

#[derive(Deserialize)]
pub struct DownloadDirArgs {
    pub conn_id: ConnectionId,
    pub remote_dir: String,
    pub local_dir: String,
}

#[tauri::command]
pub async fn sftp_download_dir(
    args: DownloadDirArgs,
    app: AppHandle,
    session_mgr: State<'_, SessionManager>,
    transfer_mgr: State<'_, TransferManager>,
    settings: State<'_, crate::settings::SettingsStore>,
) -> Result<DirTransferInit> {
    let session_mgr = (*session_mgr).clone();
    // Pick up the current SFTP concurrency before queueing, so a
    // change in Settings → Advanced applies to the next transfer.
    transfer_mgr.set_concurrency(
        crate::settings::advanced_or_default(&settings).sftp_concurrency,
    );
    let group_id = Uuid::new_v4();
    let local_root = PathBuf::from(&args.local_dir);

    // Local root + every remote subdir mirrored underneath it. Same
    // parent-first ordering as upload; `walk_dir` already sorts by depth.
    tokio::fs::create_dir_all(&local_root)
        .await
        .map_err(Error::Io)?;

    let walked = session_mgr
        .sftp_walk_dir(args.conn_id, &args.remote_dir)
        .await?;

    // First pass: mkdir all local subdirs.
    for e in walked.iter().filter(|e| e.kind == WalkedKind::Directory) {
        if transfer_mgr.is_group_cancelled(group_id).await {
            return Ok(DirTransferInit {
                group_id, file_count: 0, transfer_ids: vec![], total_bytes: 0,
            });
        }
        let sub = local_root.join(rel_to_path(&e.rel_path));
        tokio::fs::create_dir_all(&sub).await.map_err(Error::Io)?;
    }

    let mut ids = Vec::new();
    let mut total_bytes: u64 = 0;
    for e in walked.into_iter().filter(|e| e.kind == WalkedKind::File) {
        // Break early on user cancel — symmetric with `sftp_upload_dir`.
        if transfer_mgr.is_group_cancelled(group_id).await {
            break;
        }
        let remote_abs = format!(
            "{}/{}",
            args.remote_dir.trim_end_matches('/'),
            e.rel_path
        );
        let local_abs = local_root.join(rel_to_path(&e.rel_path));
        let id = transfer_mgr
            .start_download(
                app.clone(),
                session_mgr.clone(),
                args.conn_id,
                remote_abs,
                local_abs,
                Some(group_id),
            )
            .await;
        ids.push(id);
        total_bytes += e.size;
    }

    Ok(DirTransferInit {
        group_id,
        file_count: ids.len(),
        transfer_ids: ids,
        total_bytes,
    })
}

// ---------- helpers ----------

/// Recursive local walk. Returns:
/// - subdirectories: forward-slash relative paths, sorted parents-first
/// - files: `(rel_path, size)` in stable iteration order
pub(crate) async fn walk_local(root: &Path) -> Result<(Vec<String>, Vec<(String, u64)>)> {
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<(String, u64)> = Vec::new();
    let mut stack: Vec<(PathBuf, String)> = vec![(root.to_path_buf(), String::new())];
    while let Some((abs, rel)) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&abs).await.map_err(Error::Io)?;
        while let Some(entry) = rd.next_entry().await.map_err(Error::Io)? {
            let name = entry.file_name();
            let name_s = name.to_string_lossy().to_string();
            let child_rel = if rel.is_empty() {
                name_s.clone()
            } else {
                format!("{}/{}", rel, name_s)
            };
            let ft = entry.file_type().await.map_err(Error::Io)?;
            if ft.is_dir() {
                dirs.push(child_rel.clone());
                stack.push((entry.path(), child_rel));
            } else if ft.is_file() {
                let meta = entry.metadata().await.map_err(Error::Io)?;
                files.push((child_rel, meta.len()));
            }
        }
    }
    dirs.sort_by_key(|s| s.matches('/').count());
    Ok((dirs, files))
}

/// Compose a remote destination from a base + forward-slash relative path.
pub(crate) fn join_remote(base: &str, rel: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), rel)
}

/// Convert a forward-slash relative path into a platform-native `PathBuf`
/// so `local_root.join(rel_to_path(rel))` produces the right thing on
/// Windows (backslashes) as well as macOS/Linux (forward slashes).
pub(crate) fn rel_to_path(rel: &str) -> PathBuf {
    let mut pb = PathBuf::new();
    for part in rel.split('/') {
        if !part.is_empty() {
            pb.push(part);
        }
    }
    pb
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn walk_local_returns_dirs_then_files() {
        let td = TempDir::new().unwrap();
        tokio::fs::create_dir_all(td.path().join("a/b")).await.unwrap();
        tokio::fs::write(td.path().join("root.txt"), b"hi").await.unwrap();
        tokio::fs::write(td.path().join("a/x.log"), b"aaa").await.unwrap();
        tokio::fs::write(td.path().join("a/b/y.rs"), b"bbbb").await.unwrap();

        let (dirs, files) = walk_local(td.path()).await.unwrap();

        // Directories sorted parents-first.
        assert!(dirs.contains(&"a".to_string()));
        assert!(dirs.contains(&"a/b".to_string()));
        assert!(dirs.iter().position(|d| d == "a").unwrap()
            < dirs.iter().position(|d| d == "a/b").unwrap());

        let names: Vec<&str> = files.iter().map(|(r, _)| r.as_str()).collect();
        assert!(names.contains(&"root.txt"));
        assert!(names.contains(&"a/x.log"));
        assert!(names.contains(&"a/b/y.rs"));
    }

    #[test]
    fn join_remote_normalizes_trailing_slash() {
        assert_eq!(join_remote("/home/x", "a/b.txt"), "/home/x/a/b.txt");
        assert_eq!(join_remote("/home/x/", "a/b.txt"), "/home/x/a/b.txt");
        assert_eq!(join_remote("/", "a.txt"), "/a.txt");
    }

    #[test]
    fn rel_to_path_platform_correct() {
        let p = rel_to_path("a/b/c.txt");
        // Just assert it round-trips through Path::components without loss.
        let parts: Vec<_> = p.iter().map(|s| s.to_string_lossy().into_owned()).collect();
        assert_eq!(parts, vec!["a", "b", "c.txt"]);
    }
}

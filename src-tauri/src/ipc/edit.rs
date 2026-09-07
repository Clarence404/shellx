//! Edit a remote file in a local editor with auto-upload on save.
//!
//! `edit_open` downloads the remote file to a private temp copy, opens it in
//! the configured editor (or the OS default), and starts a lightweight task
//! that polls the temp file's mtime; each time it changes, the copy is
//! uploaded back over the same SFTP connection. No `notify` dependency and no
//! inode/rename pitfalls — an editor's atomic save (write-temp-then-rename)
//! still bumps the path's mtime. The round-trips use the silent one-shot SFTP
//! streams, so they never appear in the transfer strip.

use crate::error::{Error, Result};
use crate::session::manager::SessionManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use uuid::Uuid;

pub const EV_UPLOADED: &str = "edit:uploaded";
pub const EV_FAILED: &str = "edit:failed";

const POLL: Duration = Duration::from_millis(800);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EditInfo {
    pub id: String,
    pub conn_id: String,
    pub name: String,
    pub remote_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UploadedEvent {
    pub id: String,
    /// Unix millis of the upload, for the "saved at HH:MM" readout.
    pub at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FailedEvent {
    pub id: String,
    pub error: String,
}

struct EditHandle {
    abort: tokio::task::AbortHandle,
    temp_dir: std::path::PathBuf,
}

/// Active edit sessions keyed by edit id.
#[derive(Default)]
pub struct EditRegistry(Mutex<HashMap<String, EditHandle>>);

fn basename(remote_path: &str) -> String {
    remote_path.rsplit(['/', '\\']).next().unwrap_or("file").to_string()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

async fn download_to(mgr: &SessionManager, conn_id: Uuid, remote_path: &str, temp: &std::path::Path) -> Result<()> {
    let mut src = mgr.sftp_open_read(conn_id, remote_path).await?;
    let mut dst = tokio::fs::File::create(temp).await.map_err(Error::Io)?;
    tokio::io::copy(&mut src, &mut dst).await.map_err(Error::Io)?;
    dst.flush().await.map_err(Error::Io)?;
    Ok(())
}

async fn upload_from(mgr: &SessionManager, conn_id: Uuid, remote_path: &str, temp: &std::path::Path) -> Result<()> {
    let mut src = tokio::fs::File::open(temp).await.map_err(Error::Io)?;
    let mut dst = mgr.sftp_open_write(conn_id, remote_path).await?;
    tokio::io::copy(&mut src, &mut dst).await.map_err(Error::Io)?;
    dst.shutdown().await.map_err(Error::Io)?; // flush the SFTP write stream
    Ok(())
}

#[derive(Deserialize)]
pub struct EditOpenArgs {
    pub conn_id: Uuid,
    pub remote_path: String,
    /// Configured external editor path; empty/None → OS default program.
    pub editor: Option<String>,
}

#[tauri::command]
pub async fn edit_open(
    args: EditOpenArgs,
    app: AppHandle,
    mgr: State<'_, SessionManager>,
    reg: State<'_, EditRegistry>,
) -> Result<EditInfo> {
    let name = basename(&args.remote_path);
    let temp_dir = std::env::temp_dir().join("shellx-edit").join(Uuid::new_v4().to_string());
    tokio::fs::create_dir_all(&temp_dir).await.map_err(Error::Io)?;
    let temp = temp_dir.join(&name);

    let mgr_c: SessionManager = (*mgr).clone();
    download_to(&mgr_c, args.conn_id, &args.remote_path, &temp).await.map_err(|e| {
        crate::log_warn!(crate::logs::categories::SFTP, "edit: download failed",
            "remote": args.remote_path, "error": e.to_string());
        e
    })?;

    // Open in the configured editor, else the OS default handler.
    let editor = args.editor.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(ed) = editor {
        std::process::Command::new(ed).arg(&temp).spawn()
            .map_err(|e| Error::Protocol(format!("launch editor {ed}: {e}")))?;
    } else {
        crate::local::open_in_os(&temp.to_string_lossy())?;
    }

    let id = Uuid::new_v4().to_string();
    let conn_id = args.conn_id;
    let remote_path = args.remote_path.clone();
    let watch_temp = temp.clone();
    let app_c = app.clone();
    let id_c = id.clone();

    // Poll the temp file's mtime; upload back on each change.
    let task = tokio::spawn(async move {
        let mut last = tokio::fs::metadata(&watch_temp).await.ok().and_then(|m| m.modified().ok());
        loop {
            tokio::time::sleep(POLL).await;
            let m = match tokio::fs::metadata(&watch_temp).await.ok().and_then(|md| md.modified().ok()) {
                Some(m) => m,
                None => continue, // editor mid-save (file briefly gone) — skip
            };
            if Some(m) == last { continue; }
            last = Some(m);
            match upload_from(&mgr_c, conn_id, &remote_path, &watch_temp).await {
                Ok(()) => {
                    crate::log_info!(crate::logs::categories::SFTP, "edit: uploaded",
                        "remote": remote_path);
                    let _ = app_c.emit(EV_UPLOADED, UploadedEvent { id: id_c.clone(), at: now_ms() });
                }
                Err(e) => {
                    crate::log_warn!(crate::logs::categories::SFTP, "edit: upload failed",
                        "remote": remote_path, "error": e.to_string());
                    let _ = app_c.emit(EV_FAILED, FailedEvent { id: id_c.clone(), error: e.to_string() });
                }
            }
        }
    });

    reg.0.lock().await.insert(id.clone(), EditHandle { abort: task.abort_handle(), temp_dir });
    Ok(EditInfo { id, conn_id: conn_id.to_string(), name, remote_path: args.remote_path })
}

#[derive(Deserialize)]
pub struct EditStopArgs {
    pub id: String,
}

#[tauri::command]
pub async fn edit_stop(args: EditStopArgs, reg: State<'_, EditRegistry>) -> Result<()> {
    if let Some(h) = reg.0.lock().await.remove(&args.id) {
        h.abort.abort();
        let _ = tokio::fs::remove_dir_all(&h.temp_dir).await;
    }
    Ok(())
}

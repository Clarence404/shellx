//! Byte-pumping tasks for FTP and FTPS transfers.
//!
//! Each task opens its own connection from an [`FtpSpec`] once it holds a
//! queue slot, streams through the same `pump` loop the SFTP tasks use,
//! and says goodbye. A fresh connection per transfer is not an
//! implementation shortcut — FTP allows one data channel per control
//! channel, so a transfer sharing the browsing connection would freeze
//! the directory pane for its whole duration. Opening after the slot is
//! acquired also means a hundred queued files hold zero connections, not
//! a hundred.

use crate::error::Result;
use crate::ftp::client::FtpSpec;
use crate::transfer::task::{acquire_slot, finish, mark_active, pump, TaskMap};
use crate::transfer::TransferId;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::fs::File as LocalFile;
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;

pub(crate) async fn run_ftp_upload(
    app: AppHandle,
    tasks: TaskMap,
    transfer_id: TransferId,
    spec: FtpSpec,
    local: PathBuf,
    remote: String,
    mut cancel_rx: oneshot::Receiver<()>,
    pause_flag: Arc<AtomicBool>,
    gate: Arc<tokio::sync::Semaphore>,
) {
    let result: Result<()> = async {
        let _permit = acquire_slot(gate, &mut cancel_rx).await?;
        let total_bytes = tokio::fs::metadata(&local)
            .await
            .map_err(crate::error::Error::Io)?
            .len();
        mark_active(&tasks, transfer_id, total_bytes).await;

        let mut client = spec.connect().await?;
        let mut src = LocalFile::open(&local)
            .await
            .map_err(crate::error::Error::Io)?;
        let mut dst = client.open_write(&remote).await?;
        let pumped = pump(
            &app, &tasks, transfer_id, &mut src, &mut dst,
            total_bytes, &mut cancel_rx, &pause_flag,
        )
        .await;
        // The server only acknowledges the file once the data channel is
        // finalized — skip it on failure and the error wins, but a pump
        // that succeeded is not done until this is.
        match pumped {
            Ok(()) => client.finish_write(dst).await?,
            Err(e) => {
                drop(dst);
                client.quit().await;
                return Err(e);
            }
        }
        client.quit().await;
        Ok(())
    }
    .await;

    finish(&app, &tasks, transfer_id, result).await;
}

pub(crate) async fn run_ftp_download(
    app: AppHandle,
    tasks: TaskMap,
    transfer_id: TransferId,
    spec: FtpSpec,
    remote: String,
    local: PathBuf,
    mut cancel_rx: oneshot::Receiver<()>,
    pause_flag: Arc<AtomicBool>,
    gate: Arc<tokio::sync::Semaphore>,
) {
    let result: Result<()> = async {
        let _permit = acquire_slot(gate, &mut cancel_rx).await?;
        let mut client = spec.connect().await?;
        // SIZE is an extension some old boxes lack; a transfer with an
        // unknown total still transfers, the bar just cannot fill.
        let total_bytes = client.size(&remote).await.unwrap_or(0);
        mark_active(&tasks, transfer_id, total_bytes).await;

        if let Some(parent) = local.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let mut dst = LocalFile::create(&local)
            .await
            .map_err(crate::error::Error::Io)?;
        let mut src = client.open_read(&remote).await?;
        let pumped = pump(
            &app, &tasks, transfer_id, &mut src, &mut dst,
            total_bytes, &mut cancel_rx, &pause_flag,
        )
        .await;
        match pumped {
            Ok(()) => client.finish_read(src).await?,
            Err(e) => {
                drop(src);
                client.quit().await;
                return Err(e);
            }
        }
        dst.flush().await.map_err(crate::error::Error::Io)?;
        client.quit().await;
        Ok(())
    }
    .await;

    finish(&app, &tasks, transfer_id, result).await;
}

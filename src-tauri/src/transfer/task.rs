//! Byte-pumping loops for individual transfers, run as tokio tasks spawned
//! by `TransferManager::start_upload`/`start_download`. Each loop reads
//! from a source in 64 KB chunks and writes to a destination, racing a
//! `oneshot::Receiver` for cancellation on every chunk via `tokio::select!`.
//! Progress is emitted (throttled to at most once per 100ms or 64 KB,
//! whichever comes first) as `transfer:progress`, and exactly one
//! `transfer:done` event fires once the loop exits, however it exits
//! (success, cancel, or error).

use crate::error::{Error, Result};
use crate::session::manager::SessionManager;
use crate::session::ConnectionId;
use crate::transfer::{LiveTransfer, TransferId, TransferState};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs::File as LocalFile;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{oneshot, Mutex};

const CHUNK_SIZE: usize = 64 * 1024;
const PROGRESS_EMIT_INTERVAL_MS: u128 = 100;
const PROGRESS_EMIT_BYTES: u64 = 64 * 1024;
/// While paused, the task polls the flag on this cadence. Short enough
/// that resume feels instant, long enough not to burn CPU.
const PAUSE_POLL_MS: u64 = 150;

pub const EV_PROGRESS: &str = "transfer:progress";
pub const EV_DONE: &str = "transfer:done";
pub const EV_STATE: &str = "transfer:state";

#[derive(Serialize, Clone)]
pub struct StateEvent {
    pub transfer_id: TransferId,
    pub state: TransferState,
}

/// Internal-only marker distinguishing an operator-initiated cancel from an
/// ordinary I/O/protocol failure when mapping the loop's `Result<()>` to a
/// `TransferState` in `finish()`. Not a dedicated `Error` variant — this is
/// purely local control flow within this module.
const CANCELLED_MARKER: &str = "cancelled";

#[derive(Serialize, Clone)]
pub struct ProgressEvent {
    pub transfer_id: TransferId,
    pub bytes_done: u64,
    pub total_bytes: u64,
    pub rate_bps: u64,
}

#[derive(Serialize, Clone)]
pub struct DoneEvent {
    pub transfer_id: TransferId,
    pub state: TransferState,
}

type TaskMap = Arc<Mutex<HashMap<TransferId, LiveTransfer>>>;

async fn mark_active(tasks: &TaskMap, id: TransferId, total_bytes: u64) {
    if let Some(t) = tasks.lock().await.get_mut(&id) {
        t.info.total_bytes = total_bytes;
        t.info.state = TransferState::Active;
    }
}

/// Emits `transfer:progress` and updates the shared `TransferInfo.bytes_done`
/// if at least `PROGRESS_EMIT_INTERVAL_MS` elapsed OR at least
/// `PROGRESS_EMIT_BYTES` were transferred since the last emit — using
/// `Instant::now()` deltas rather than a naive per-chunk counter, so a fast
/// local-network transfer (many sub-100ms chunks) doesn't spam events.
#[allow(clippy::too_many_arguments)]
async fn maybe_emit_progress(
    app: &AppHandle,
    tasks: &TaskMap,
    id: TransferId,
    done: u64,
    total_bytes: u64,
    start: Instant,
    last_emit: &mut Instant,
    last_emit_bytes: &mut u64,
) {
    let elapsed_ms = last_emit.elapsed().as_millis();
    let bytes_since = done.saturating_sub(*last_emit_bytes);
    if elapsed_ms < PROGRESS_EMIT_INTERVAL_MS && bytes_since < PROGRESS_EMIT_BYTES {
        return;
    }
    let elapsed_s = start.elapsed().as_secs_f64().max(0.001);
    let rate = (done as f64 / elapsed_s) as u64;
    let _ = app.emit(
        EV_PROGRESS,
        ProgressEvent {
            transfer_id: id,
            bytes_done: done,
            total_bytes,
            rate_bps: rate,
        },
    );
    if let Some(t) = tasks.lock().await.get_mut(&id) {
        t.info.bytes_done = done;
    }
    *last_emit = Instant::now();
    *last_emit_bytes = done;
}

/// Maps the loop's terminal `Result` to a `TransferState`, updates the
/// shared map (clearing `cancel` since there's nothing left to cancel), and
/// fires the single `transfer:done` event for this transfer.
async fn finish(app: &AppHandle, tasks: &TaskMap, id: TransferId, result: Result<()>) {
    let final_state = match result {
        Ok(()) => TransferState::Done,
        Err(Error::Protocol(msg)) if msg == CANCELLED_MARKER => TransferState::Cancelled,
        Err(e) => TransferState::Failed {
            error: e.to_string(),
        },
    };
    let summary = {
        let mut guard = tasks.lock().await;
        guard.get_mut(&id).map(|t| {
            t.info.state = final_state.clone();
            t.cancel = None;
            (
                format!("{:?}", t.info.direction).to_lowercase(),
                t.info.local_path.clone(),
                t.info.remote_path.clone(),
                t.info.bytes_done,
                t.info.total_bytes,
            )
        })
    };
    // One line per transfer, at the level its outcome deserves — this is
    // what the Logs panel shows when a queue entry ends up red.
    if let Some((direction, local, remote, done, total)) = summary {
        match &final_state {
            TransferState::Done => crate::log_info!(
                crate::logs::categories::TRANSFER, "transfer finished",
                "transfer": id.to_string(), "direction": direction,
                "local": local, "remote": remote, "bytes": done,
            ),
            TransferState::Cancelled => crate::log_warn!(
                crate::logs::categories::TRANSFER, "transfer cancelled",
                "transfer": id.to_string(), "direction": direction,
                "local": local, "remote": remote, "bytes": done, "total_bytes": total,
            ),
            TransferState::Failed { error } => crate::log_error!(
                crate::logs::categories::TRANSFER, "transfer failed",
                "transfer": id.to_string(), "direction": direction,
                "local": local, "remote": remote, "bytes": done, "total_bytes": total,
                "error": error,
            ),
            _ => {}
        }
    }
    let _ = app.emit(
        EV_DONE,
        DoneEvent {
            transfer_id: id,
            state: final_state,
        },
    );
}

/// Blocks (yielding to the runtime) while the pause flag is set. Wakes
/// on either the flag clearing OR a cancellation signal. Returns `Err`
/// if the caller was cancelled during the pause; the caller should
/// propagate that as the terminal state.
async fn wait_while_paused(
    pause_flag: &AtomicBool,
    cancel_rx: &mut oneshot::Receiver<()>,
) -> Result<()> {
    while pause_flag.load(Ordering::Acquire) {
        tokio::select! {
            _ = &mut *cancel_rx => {
                return Err(Error::Protocol(CANCELLED_MARKER.into()));
            }
            _ = tokio::time::sleep(Duration::from_millis(PAUSE_POLL_MS)) => {}
        }
    }
    Ok(())
}

/// Wait for a transfer slot, honouring a cancel that arrives while
/// queued. Returns the permit, which the caller holds for the rest of the
/// transfer — dropping it hands the slot to the next queued transfer.
async fn acquire_slot(
    gate: Arc<tokio::sync::Semaphore>,
    cancel_rx: &mut oneshot::Receiver<()>,
) -> Result<tokio::sync::OwnedSemaphorePermit> {
    tokio::select! {
        _ = &mut *cancel_rx => Err(Error::Protocol(CANCELLED_MARKER.into())),
        permit = gate.acquire_owned() => permit
            .map_err(|e| Error::Protocol(format!("transfer gate closed: {e}"))),
    }
}

/// Pumps `local` -> `remote` over the connection's SFTP subsystem (opened
/// lazily by `SessionManager::sftp_open_write` on first use).
pub(crate) async fn run_upload(
    app: AppHandle,
    tasks: TaskMap,
    transfer_id: TransferId,
    local: PathBuf,
    remote: String,
    mut cancel_rx: oneshot::Receiver<()>,
    pause_flag: Arc<AtomicBool>,
    session_mgr: SessionManager,
    conn_id: ConnectionId,
    gate: Arc<tokio::sync::Semaphore>,
) {
    let result: Result<()> = async {
        let _permit = acquire_slot(gate, &mut cancel_rx).await?;
        let meta = tokio::fs::metadata(&local).await.map_err(Error::Io)?;
        let total_bytes = meta.len();
        mark_active(&tasks, transfer_id, total_bytes).await;

        let mut src = LocalFile::open(&local).await.map_err(Error::Io)?;
        let mut dst = session_mgr.sftp_open_write(conn_id, &remote).await?;

        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut done: u64 = 0;
        let start = Instant::now();
        let mut last_emit = Instant::now();
        let mut last_emit_bytes: u64 = 0;

        loop {
            wait_while_paused(&pause_flag, &mut cancel_rx).await?;
            // Read is quick (local fs); cancel is polled here.
            let n = tokio::select! {
                _ = &mut cancel_rx => {
                    return Err(Error::Protocol(CANCELLED_MARKER.into()));
                }
                r = src.read(&mut buf) => r.map_err(Error::Io)?,
            };
            if n == 0 { break; }
            // Write is the slow / potentially-blocked side (shared SFTP
            // channel with 10 concurrent tasks). Wrap it in a second
            // select so a `transferCancel` fires immediately even when
            // the write is stalled — the previous shape only checked
            // cancel between chunks, so a stuck write would swallow
            // cancels indefinitely.
            tokio::select! {
                _ = &mut cancel_rx => {
                    return Err(Error::Protocol(CANCELLED_MARKER.into()));
                }
                r = dst.write_all(&buf[..n]) => r.map_err(Error::Io)?,
            }
            done += n as u64;
            maybe_emit_progress(
                &app, &tasks, transfer_id, done, total_bytes, start,
                &mut last_emit, &mut last_emit_bytes,
            ).await;
        }
        dst.shutdown().await.map_err(Error::Io)?;
        Ok(())
    }
    .await;

    finish(&app, &tasks, transfer_id, result).await;
}

/// Pumps `remote` -> `local` over the connection's SFTP subsystem (opened
/// lazily by `SessionManager::sftp_open_read` on first use). Symmetric to
/// `run_upload`.
pub(crate) async fn run_download(
    app: AppHandle,
    tasks: TaskMap,
    transfer_id: TransferId,
    remote: String,
    local: PathBuf,
    mut cancel_rx: oneshot::Receiver<()>,
    pause_flag: Arc<AtomicBool>,
    session_mgr: SessionManager,
    conn_id: ConnectionId,
    gate: Arc<tokio::sync::Semaphore>,
) {
    let result: Result<()> = async {
        let _permit = acquire_slot(gate, &mut cancel_rx).await?;
        let total_bytes = session_mgr
            .sftp_stat(conn_id, &remote)
            .await
            .map(|e| e.size)
            .unwrap_or(0);
        mark_active(&tasks, transfer_id, total_bytes).await;

        let mut src = session_mgr.sftp_open_read(conn_id, &remote).await?;
        if let Some(parent) = local.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        let mut dst = LocalFile::create(&local).await.map_err(Error::Io)?;

        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut done: u64 = 0;
        let start = Instant::now();
        let mut last_emit = Instant::now();
        let mut last_emit_bytes: u64 = 0;

        loop {
            wait_while_paused(&pause_flag, &mut cancel_rx).await?;
            // Read is the slow side for downloads (SFTP-over-SSH); wrap
            // in select so cancel fires promptly even mid-stream.
            let n = tokio::select! {
                _ = &mut cancel_rx => {
                    return Err(Error::Protocol(CANCELLED_MARKER.into()));
                }
                r = src.read(&mut buf) => r.map_err(Error::Io)?,
            };
            if n == 0 { break; }
            tokio::select! {
                _ = &mut cancel_rx => {
                    return Err(Error::Protocol(CANCELLED_MARKER.into()));
                }
                r = dst.write_all(&buf[..n]) => r.map_err(Error::Io)?,
            }
            done += n as u64;
            maybe_emit_progress(
                &app, &tasks, transfer_id, done, total_bytes, start,
                &mut last_emit, &mut last_emit_bytes,
            ).await;
        }
        dst.flush().await.map_err(Error::Io)?;
        Ok(())
    }
    .await;

    finish(&app, &tasks, transfer_id, result).await;
}

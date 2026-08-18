//! Tauri IPC surface for the logs subsystem.
//!
//! Three commands:
//! - `logs_snapshot(filter, limit, after_id)` — one-shot fetch
//! - `logs_subscribe()` / `logs_unsubscribe()` — start / stop a
//!   background pump that emits `logs:entry` events to the frontend.
//!   Frontend flips this on when the Logs panel goes into live mode.
//! - `logs_export(range)` — dump matching entries as jsonl to a
//!   user-picked file.
//! - `logs_set_disk_enabled(enabled)` — user toggle in Settings.

use crate::error::{Error, Result};
use crate::logs::{LogEntry, LogFilter, LogsStats, LogsStore};
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
pub struct LogsSnapshotResult {
    pub entries: Vec<LogEntry>,
    pub stats: LogsStats,
}

#[tauri::command]
pub async fn logs_snapshot(
    filter: Option<LogFilter>,
    limit: Option<usize>,
    after_id: Option<u64>,
    store: State<'_, Arc<LogsStore>>,
) -> Result<LogsSnapshotResult> {
    let filter = filter.unwrap_or_default();
    let limit = limit.unwrap_or(500).min(2000);
    let entries = store.snapshot(&filter, limit, after_id);
    let stats = store.stats(&filter);
    Ok(LogsSnapshotResult { entries, stats })
}

/// Shared flag so the pump task can be politely asked to stop when the
/// user leaves the Logs panel or flips the live toggle off.
static PUMP_ACTIVE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn logs_subscribe(
    store: State<'_, Arc<LogsStore>>,
    app: AppHandle,
) -> Result<()> {
    if PUMP_ACTIVE.swap(true, Ordering::SeqCst) {
        // Already pumping — no-op.
        return Ok(());
    }
    let mut rx = store.subscribe();
    tokio::spawn(async move {
        while PUMP_ACTIVE.load(Ordering::SeqCst) {
            match rx.recv().await {
                Ok(entry) => {
                    let _ = app.emit("logs:entry", &entry);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // Signal the frontend that some entries were dropped.
                    let _ = app.emit("logs:lagged", ());
                }
                Err(_) => break,
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn logs_unsubscribe() -> Result<()> {
    PUMP_ACTIVE.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn logs_export(
    path: String,
    filter: Option<LogFilter>,
    store: State<'_, Arc<LogsStore>>,
) -> Result<u64> {
    let filter = filter.unwrap_or_default();
    // Grab up to the full ring — export is intentionally unbounded.
    let entries = store.snapshot(&filter, 10_000, None);
    let mut written = 0u64;
    let mut out = String::with_capacity(entries.len() * 200);
    // Reverse so exported file goes oldest → newest, matching jsonl convention.
    for entry in entries.iter().rev() {
        match serde_json::to_string(entry) {
            Ok(line) => {
                out.push_str(&line);
                out.push('\n');
                written += 1;
            }
            Err(_) => continue,
        }
    }
    std::fs::write(&path, out).map_err(|e| Error::Protocol(format!("export failed: {e}")))?;
    Ok(written)
}

#[tauri::command]
pub async fn logs_set_disk_enabled(
    enabled: bool,
    store: State<'_, Arc<LogsStore>>,
) -> Result<()> {
    store.set_disk_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub async fn logs_disk_enabled(store: State<'_, Arc<LogsStore>>) -> Result<bool> {
    Ok(store.disk_enabled())
}

/// Frontend-side event push. Lets React code (e.g. the tunnel
/// auto-reconnect state machine) record its own decisions into the same
/// log stream that backend uses. Sensitive data must not be passed.
#[derive(serde::Deserialize)]
pub struct LogPushArgs {
    pub level: String,      // "debug" | "info" | "warn" | "error"
    pub category: String,
    pub message: String,
    #[serde(default)]
    pub fields: serde_json::Value,
}

#[tauri::command]
pub async fn logs_push(
    args: LogPushArgs,
    store: State<'_, Arc<LogsStore>>,
) -> Result<()> {
    let level = crate::logs::Level::from_str(&args.level).unwrap_or(crate::logs::Level::Info);
    store.push(level, &args.category, args.message, args.fields);
    Ok(())
}

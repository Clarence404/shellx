//! Runs upload/download transfers as background tokio tasks, tracking
//! progress and supporting cancellation. See `task.rs` for the actual
//! byte-pumping loops.
//!
//! `TransferManager` intentionally doesn't hold a `SessionManager` of its
//! own — callers hand one in per-transfer (see `start_upload`/
//! `start_download`). `SessionManager`'s fields are already
//! `Arc<Mutex<...>>`, so it derives `Clone` cheaply: every clone shares the
//! same underlying connection map, which is exactly what a spawned transfer
//! task needs to reach `SftpHandle` methods without requiring
//! `SessionManager` itself to be wrapped in `Arc` at the Tauri `.manage()`
//! call site — Task 4's IPC handlers keep using `State<'_, SessionManager>`
//! unchanged.

use crate::error::Result;
use crate::session::manager::SessionManager;
use crate::session::ConnectionId;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

pub mod task;

pub type TransferId = Uuid;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Upload,
    Download,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TransferState {
    Queued,
    Active,
    Done,
    Cancelled,
    Failed { error: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct TransferInfo {
    pub id: TransferId,
    pub connection_id: ConnectionId,
    pub direction: Direction,
    pub local_path: String,
    pub remote_path: String,
    pub total_bytes: u64,
    pub bytes_done: u64,
    pub state: TransferState,
    pub started_at: i64,
}

// `pub(crate)`, not private: `task::run_upload`/`run_download` are `pub` (so
// `TransferManager::start_upload`/`start_download` can spawn them from this
// module) and their signatures name `LiveTransfer` via `TaskMap`. Keeping it
// at least as visible as those functions avoids a `private_interfaces`
// lint; `pub(crate)` still keeps it out of the crate's public API.
pub(crate) struct LiveTransfer {
    info: TransferInfo,
    cancel: Option<oneshot::Sender<()>>,
}

/// Owns every in-flight transfer keyed by `TransferId`. Each transfer's
/// byte-pumping loop runs in its own `tokio::spawn`'d task (see `task.rs`);
/// the manager's mutex is only ever held for the brief map lookups/updates
/// below, never across the task's I/O — same invariant `SessionManager`
/// follows for shell channels.
pub struct TransferManager {
    tasks: Arc<Mutex<HashMap<TransferId, LiveTransfer>>>,
}

impl TransferManager {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn list(&self) -> Vec<TransferInfo> {
        self.tasks
            .lock()
            .await
            .values()
            .map(|t| t.info.clone())
            .collect()
    }

    /// Takes the cancellation sender out of the map (if the transfer is
    /// still known and not already finished) and signals it. Unknown ids
    /// are not an error — cancelling something that already finished (or
    /// never existed) is a no-op, matching the brief's stub behavior.
    pub async fn cancel(&self, id: TransferId) -> Result<()> {
        let sender = {
            let mut map = self.tasks.lock().await;
            map.get_mut(&id).and_then(|t| t.cancel.take())
        };
        if let Some(s) = sender {
            let _ = s.send(());
        }
        Ok(())
    }

    fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// Registers a new upload transfer and spawns its byte-pumping task.
    /// Returns immediately with the new `TransferId`; progress and
    /// completion are reported via `transfer:progress`/`transfer:done`
    /// events, not this call's return value.
    pub async fn start_upload(
        &self,
        app: AppHandle,
        session_mgr: SessionManager,
        conn_id: ConnectionId,
        local: PathBuf,
        remote: String,
    ) -> TransferId {
        let id = Uuid::new_v4();
        let (tx, rx) = oneshot::channel();
        let info = TransferInfo {
            id,
            connection_id: conn_id,
            direction: Direction::Upload,
            local_path: local.to_string_lossy().into_owned(),
            remote_path: remote.clone(),
            total_bytes: 0,
            bytes_done: 0,
            state: TransferState::Queued,
            started_at: Self::now_ms(),
        };
        self.tasks.lock().await.insert(
            id,
            LiveTransfer {
                info,
                cancel: Some(tx),
            },
        );
        let tasks_clone = self.tasks.clone();
        tokio::spawn(task::run_upload(
            app,
            tasks_clone,
            id,
            local,
            remote,
            rx,
            session_mgr,
            conn_id,
        ));
        id
    }

    /// Registers a new download transfer and spawns its byte-pumping task.
    /// Symmetric to `start_upload`.
    pub async fn start_download(
        &self,
        app: AppHandle,
        session_mgr: SessionManager,
        conn_id: ConnectionId,
        remote: String,
        local: PathBuf,
    ) -> TransferId {
        let id = Uuid::new_v4();
        let (tx, rx) = oneshot::channel();
        let info = TransferInfo {
            id,
            connection_id: conn_id,
            direction: Direction::Download,
            local_path: local.to_string_lossy().into_owned(),
            remote_path: remote.clone(),
            total_bytes: 0,
            bytes_done: 0,
            state: TransferState::Queued,
            started_at: Self::now_ms(),
        };
        self.tasks.lock().await.insert(
            id,
            LiveTransfer {
                info,
                cancel: Some(tx),
            },
        );
        let tasks_clone = self.tasks.clone();
        tokio::spawn(task::run_download(
            app,
            tasks_clone,
            id,
            remote,
            local,
            rx,
            session_mgr,
            conn_id,
        ));
        id
    }
}

impl Default for TransferManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn transfer_manager_list_starts_empty() {
        let mgr = TransferManager::new();
        assert!(mgr.list().await.is_empty());
    }

    #[tokio::test]
    async fn cancel_unknown_id_is_ok() {
        let mgr = TransferManager::new();
        mgr.cancel(Uuid::new_v4()).await.unwrap();
    }

    fn dummy_info(id: TransferId) -> TransferInfo {
        TransferInfo {
            id,
            connection_id: Uuid::new_v4(),
            direction: Direction::Upload,
            local_path: "/x".into(),
            remote_path: "/y".into(),
            total_bytes: 100,
            bytes_done: 0,
            state: TransferState::Queued,
            started_at: 0,
        }
    }

    #[tokio::test]
    async fn transfer_appears_in_list_and_cancel_takes_sender() {
        let mgr = TransferManager::new();
        let (tx, _rx) = oneshot::channel();
        let id = Uuid::new_v4();
        mgr.tasks.lock().await.insert(
            id,
            LiveTransfer {
                info: dummy_info(id),
                cancel: Some(tx),
            },
        );
        assert_eq!(mgr.list().await.len(), 1);
        mgr.cancel(id).await.unwrap();
        // After cancel, the sender is taken out of the LiveTransfer.
        assert!(mgr.tasks.lock().await.get(&id).unwrap().cancel.is_none());
    }

    #[tokio::test]
    async fn cancelling_a_transfer_keeps_it_listed_until_the_task_removes_it() {
        // cancel() only takes the sender; the transfer itself stays in the
        // map (with cancel: None) until the spawned task observes the
        // signal and updates its own state to Cancelled. list() should
        // still report it in the meantime.
        let mgr = TransferManager::new();
        let (tx, _rx) = oneshot::channel();
        let id = Uuid::new_v4();
        mgr.tasks.lock().await.insert(
            id,
            LiveTransfer {
                info: dummy_info(id),
                cancel: Some(tx),
            },
        );
        mgr.cancel(id).await.unwrap();
        assert_eq!(mgr.list().await.len(), 1);
    }
}

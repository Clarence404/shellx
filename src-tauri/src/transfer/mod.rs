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
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

pub mod ftp_task;
pub mod task;

pub type TransferId = Uuid;

/// Emitted right before a transfer's byte-pumping task is spawned, carrying
/// the full `TransferInfo` so the frontend can insert a `Queued`-state stub
/// into `TransfersStore` for ids it has never seen before. Mirrors
/// `task::EV_PROGRESS`/`task::EV_DONE`'s naming, colocated here since this is
/// the only place it's emitted from.
pub const EV_STARTED: &str = "transfer:started";

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
    /// User paused the transfer. The byte-pumping loop is parked on a
    /// short poll of the `pause_flag`; a resume flips the flag back off.
    Paused,
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
    /// When a directory upload/download spawns N per-file transfers, every
    /// child shares the same `group_id`. Frontend uses it to render the
    /// group as a single expandable row (T3). Single-file transfers leave
    /// this `None`. `camelCase` on the wire to match the existing frontend
    /// `TransferInfo` type's convention (rest of the struct is `snake_case`,
    /// which the frontend already consumes as-is).
    #[serde(rename = "groupId")]
    pub group_id: Option<TransferId>,
}

// `pub(crate)`, not private: `task::run_upload`/`run_download` are `pub` (so
// `TransferManager::start_upload`/`start_download` can spawn them from this
// module) and their signatures name `LiveTransfer` via `TaskMap`. Keeping it
// at least as visible as those functions avoids a `private_interfaces`
// lint; `pub(crate)` still keeps it out of the crate's public API.
pub(crate) struct LiveTransfer {
    pub(crate) info: TransferInfo,
    pub(crate) cancel: Option<oneshot::Sender<()>>,
    /// Shared with the byte-pumping task. `true` while the user has the
    /// transfer paused; task loops park on a short poll until it's
    /// cleared. `Arc<AtomicBool>` so both the task and `TransferManager`
    /// hold cheap handles.
    pub(crate) pause_flag: Arc<AtomicBool>,
}

/// Owns every in-flight transfer keyed by `TransferId`. Each transfer's
/// byte-pumping loop runs in its own `tokio::spawn`'d task (see `task.rs`);
/// the manager's mutex is only ever held for the brief map lookups/updates
/// below, never across the task's I/O — same invariant `SessionManager`
/// follows for shell channels.
pub struct TransferManager {
    tasks: Arc<Mutex<HashMap<TransferId, LiveTransfer>>>,
    /// Groups the user has explicitly cancelled. `sftp_upload_dir` /
    /// `sftp_download_dir`'s enumeration loop consults this on every
    /// iteration so a cancel click on a 2 500-file directory doesn't
    /// keep spawning new children after the click — the loop breaks
    /// early. Group ids are UUIDv4 random and the set never gets
    /// cleaned up (a few bytes per group), which is fine for the size
    /// of state a user could plausibly accumulate.
    cancelled_groups: Arc<Mutex<HashSet<TransferId>>>,
    /// How many byte-pumps may run at once (Settings → Advanced → SFTP
    /// concurrency) — one gate per direction, each with the full cap.
    /// One gate for both was a real flaw: the semaphore is FIFO, so a
    /// 2 KB download queued behind a 190 GB directory upload waited for
    /// all of it. The link is full duplex; uploads and downloads do not
    /// contend, so they no longer queue on each other.
    ///
    /// Swapped wholesale when the setting changes: in-flight transfers
    /// keep the permit they took from the old semaphore and finish
    /// against it, newly queued ones queue on the new one. A std Mutex
    /// (not tokio's) because the critical section is a clone of an Arc.
    up_gate: std::sync::Mutex<Arc<tokio::sync::Semaphore>>,
    down_gate: std::sync::Mutex<Arc<tokio::sync::Semaphore>>,
    gate_cap: std::sync::atomic::AtomicU32,
}

impl TransferManager {
    pub fn new() -> Self {
        let cap = crate::settings::AdvancedSettings::default().sftp_concurrency;
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
            cancelled_groups: Arc::new(Mutex::new(HashSet::new())),
            up_gate: std::sync::Mutex::new(Arc::new(tokio::sync::Semaphore::new(cap as usize))),
            down_gate: std::sync::Mutex::new(Arc::new(tokio::sync::Semaphore::new(cap as usize))),
            gate_cap: std::sync::atomic::AtomicU32::new(cap),
        }
    }

    /// Point the gate at a new cap. Called before each queueing command
    /// with the current setting, so a change applies to the next
    /// transfer without an app restart. A no-op when the cap is
    /// unchanged, which is the common case.
    pub fn set_concurrency(&self, cap: u32) {
        let cap = cap.clamp(1, 16);
        if self.gate_cap.swap(cap, std::sync::atomic::Ordering::Relaxed) == cap {
            return;
        }
        for gate in [&self.up_gate, &self.down_gate] {
            let fresh = Arc::new(tokio::sync::Semaphore::new(cap as usize));
            match gate.lock() {
                Ok(mut g) => *g = fresh,
                Err(p) => *p.into_inner() = fresh,
            }
        }
        crate::log_info!(
            crate::logs::categories::TRANSFER, "concurrency limit changed",
            "limit": cap,
        );
    }

    /// The semaphore new tasks of this direction should queue on.
    fn gate_handle(&self, direction: Direction) -> Arc<tokio::sync::Semaphore> {
        let gate = match direction {
            Direction::Upload => &self.up_gate,
            Direction::Download => &self.down_gate,
        };
        match gate.lock() {
            Ok(g) => g.clone(),
            Err(p) => p.into_inner().clone(),
        }
    }

    /// A snapshot of one transfer's info, for retry.
    pub async fn info(&self, id: TransferId) -> Option<TransferInfo> {
        self.tasks.lock().await.get(&id).map(|t| t.info.clone())
    }

    /// Drops a transfer that is no longer running from the map, so a
    /// dismissed failure does not come back on the next `transfer_list`.
    /// Refuses to touch a live one — that is what cancel is for.
    pub async fn remove_terminal(&self, id: TransferId) -> bool {
        let mut tasks = self.tasks.lock().await;
        let removable = tasks.get(&id).map(|t| {
            matches!(
                t.info.state,
                TransferState::Done | TransferState::Cancelled | TransferState::Failed { .. }
            )
        });
        if removable == Some(true) {
            tasks.remove(&id);
            true
        } else {
            false
        }
    }

    /// Consulted by `sftp_upload_dir` / `sftp_download_dir` between
    /// per-file iterations. Returns true once the caller has invoked
    /// `cancel_group` for this id — the loop should break out of its
    /// remaining spawn work.
    pub async fn is_group_cancelled(&self, group_id: TransferId) -> bool {
        self.cancelled_groups.lock().await.contains(&group_id)
    }

    /// Cancels every currently-spawned child of the group AND flags
    /// the group so any not-yet-spawned children are skipped by the
    /// enumeration loop. This is what the frontend's group `✕` button
    /// hits — the previous approach (loop `transferCancel(id)` over
    /// `childIds` on the JS side) couldn't stop mid-enumeration
    /// spawns because those child ids didn't yet exist.
    pub async fn cancel_group(&self, group_id: TransferId) -> Result<()> {
        self.cancelled_groups.lock().await.insert(group_id);
        // Snapshot the id list first so we don't hold `tasks.lock` across
        // the individual `cancel(id).await` calls (each takes the same
        // lock briefly).
        let ids: Vec<TransferId> = {
            let map = self.tasks.lock().await;
            map.iter()
                .filter(|(_, t)| t.info.group_id == Some(group_id))
                .map(|(id, _)| *id)
                .collect()
        };
        crate::log_info!(
            crate::logs::categories::TRANSFER, "cancelling transfer group",
            "group": group_id.to_string(),
            "children": ids.len(),
        );
        for id in ids {
            let _ = self.cancel(id).await;
        }
        Ok(())
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
    /// If the transfer is currently paused we ALSO flip the pause flag
    /// off so the byte-pumping loop unparks and observes the cancel.
    /// Pauses every queued or active transfer (optionally one
    /// connection's), in one pass. No per-id events: the caller flips
    /// its own list optimistically, and 20 000 state events would melt
    /// the frontend for nothing.
    pub async fn pause_all(&self, filter: Option<ConnectionId>) -> usize {
        let mut map = self.tasks.lock().await;
        let mut n = 0;
        for t in map.values_mut() {
            if let Some(c) = filter {
                if t.info.connection_id != c { continue; }
            }
            if matches!(t.info.state, TransferState::Queued | TransferState::Active) {
                t.pause_flag.store(true, Ordering::Release);
                t.info.state = TransferState::Paused;
                n += 1;
            }
        }
        crate::log_info!(
            crate::logs::categories::TRANSFER, "paused all transfers",
            "count": n,
        );
        n
    }

    /// The inverse of `pause_all`. A transfer paused before it ever
    /// held a slot simply goes back to waiting for one.
    pub async fn resume_all(&self, filter: Option<ConnectionId>) -> usize {
        let mut map = self.tasks.lock().await;
        let mut n = 0;
        for t in map.values_mut() {
            if let Some(c) = filter {
                if t.info.connection_id != c { continue; }
            }
            if matches!(t.info.state, TransferState::Paused) {
                t.pause_flag.store(false, Ordering::Release);
                t.info.state = TransferState::Active;
                n += 1;
            }
        }
        n
    }

    /// Cancels everything in flight (optionally one connection's) in one
    /// pass: every group is marked so enumeration loops stop spawning,
    /// and every task gets its cancel signal.
    pub async fn cancel_all(&self, filter: Option<ConnectionId>) -> usize {
        let mut groups: Vec<TransferId> = Vec::new();
        let mut n = 0;
        {
            let mut map = self.tasks.lock().await;
            for t in map.values_mut() {
                if let Some(c) = filter {
                    if t.info.connection_id != c { continue; }
                }
                if !matches!(
                    t.info.state,
                    TransferState::Queued | TransferState::Active | TransferState::Paused
                ) { continue; }
                if let Some(g) = t.info.group_id {
                    if !groups.contains(&g) { groups.push(g); }
                }
                t.pause_flag.store(false, Ordering::Release);
                if let Some(sender) = t.cancel.take() {
                    let _ = sender.send(());
                    n += 1;
                }
            }
        }
        let mut cancelled = self.cancelled_groups.lock().await;
        for g in groups { cancelled.insert(g); }
        crate::log_info!(
            crate::logs::categories::TRANSFER, "cancelled all transfers",
            "count": n,
        );
        n
    }

    pub async fn cancel(&self, id: TransferId) -> Result<()> {
        let (sender, pause) = {
            let mut map = self.tasks.lock().await;
            match map.get_mut(&id) {
                Some(t) => (t.cancel.take(), Some(t.pause_flag.clone())),
                None => (None, None),
            }
        };
        if let Some(p) = pause {
            p.store(false, Ordering::Release);
        }
        if let Some(s) = sender {
            let _ = s.send(());
        }
        Ok(())
    }

    /// Sets the transfer's pause flag; the task's loop parks on a short
    /// poll and stops pumping bytes until `resume` clears the flag.
    /// Emits a `transfer:state` event so the frontend can reflect the
    /// paused state immediately (there's no progress tick while parked).
    /// Unknown ids and terminal-state transfers are no-ops.
    pub async fn pause(&self, app: AppHandle, id: TransferId) -> Result<()> {
        let (flag, was_running) = {
            let map = self.tasks.lock().await;
            match map.get(&id) {
                Some(t) => (
                    Some(t.pause_flag.clone()),
                    matches!(
                        t.info.state,
                        TransferState::Queued | TransferState::Active
                    ),
                ),
                None => (None, false),
            }
        };
        if !was_running {
            return Ok(());
        }
        if let Some(f) = flag {
            f.store(true, Ordering::Release);
        }
        // Optimistically mark state=Paused in the map so `list()`
        // reflects it right away; the task itself only observes the
        // flag on its next chunk boundary.
        if let Some(t) = self.tasks.lock().await.get_mut(&id) {
            t.info.state = TransferState::Paused;
        }
        crate::log_info!(
            crate::logs::categories::TRANSFER, "transfer paused",
            "transfer": id.to_string(),
        );
        let _ = app.emit(
            crate::transfer::task::EV_STATE,
            crate::transfer::task::StateEvent {
                transfer_id: id,
                state: TransferState::Paused,
            },
        );
        Ok(())
    }

    /// Clears the pause flag so the loop resumes pumping bytes. Emits a
    /// `transfer:state` event returning the transfer to Active. Unknown
    /// ids and non-paused transfers are no-ops.
    pub async fn resume(&self, app: AppHandle, id: TransferId) -> Result<()> {
        let flag = {
            let map = self.tasks.lock().await;
            match map.get(&id) {
                Some(t) if matches!(t.info.state, TransferState::Paused) => {
                    Some(t.pause_flag.clone())
                }
                _ => None,
            }
        };
        let Some(f) = flag else { return Ok(()) };
        f.store(false, Ordering::Release);
        if let Some(t) = self.tasks.lock().await.get_mut(&id) {
            t.info.state = TransferState::Active;
        }
        crate::log_info!(
            crate::logs::categories::TRANSFER, "transfer resumed",
            "transfer": id.to_string(),
        );
        let _ = app.emit(
            crate::transfer::task::EV_STATE,
            crate::transfer::task::StateEvent {
                transfer_id: id,
                state: TransferState::Active,
            },
        );
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
    /// events, not this call's return value. `group_id` ties this transfer
    /// to a parent directory operation — pass `None` for a plain
    /// single-file upload.
    pub async fn start_upload(
        &self,
        app: AppHandle,
        session_mgr: SessionManager,
        conn_id: ConnectionId,
        local: PathBuf,
        remote: String,
        group_id: Option<TransferId>,
        expected_bytes: u64,
    ) -> TransferId {
        let id = Uuid::new_v4();
        let (tx, rx) = oneshot::channel();
        let info = TransferInfo {
            id,
            connection_id: conn_id,
            direction: Direction::Upload,
            local_path: local.to_string_lossy().into_owned(),
            remote_path: remote.clone(),
            // The walk that spawned this knows the size already; a task
            // corrects it when it starts. 0 stays 0 only for a caller
            // that genuinely does not know.
            total_bytes: expected_bytes,
            bytes_done: 0,
            state: TransferState::Queued,
            started_at: Self::now_ms(),
            group_id,
        };
        let pause_flag = Arc::new(AtomicBool::new(false));
        self.tasks.lock().await.insert(
            id,
            LiveTransfer {
                info: info.clone(),
                cancel: Some(tx),
                pause_flag: pause_flag.clone(),
            },
        );
        crate::log_info!(
            crate::logs::categories::TRANSFER, "upload queued",
            "transfer": id.to_string(),
            "session": conn_id.to_string(),
            "local": info.local_path,
            "remote": info.remote_path,
        );
        let _ = app.emit(EV_STARTED, &info);
        let tasks_clone = self.tasks.clone();
        tokio::spawn(task::run_upload(
            app,
            tasks_clone,
            id,
            local,
            remote,
            rx,
            pause_flag,
            session_mgr,
            conn_id,
            self.gate_handle(Direction::Upload),
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
        group_id: Option<TransferId>,
        expected_bytes: u64,
    ) -> TransferId {
        let id = Uuid::new_v4();
        let (tx, rx) = oneshot::channel();
        let info = TransferInfo {
            id,
            connection_id: conn_id,
            direction: Direction::Download,
            local_path: local.to_string_lossy().into_owned(),
            remote_path: remote.clone(),
            // The walk that spawned this knows the size already; a task
            // corrects it when it starts. 0 stays 0 only for a caller
            // that genuinely does not know.
            total_bytes: expected_bytes,
            bytes_done: 0,
            state: TransferState::Queued,
            started_at: Self::now_ms(),
            group_id,
        };
        let pause_flag = Arc::new(AtomicBool::new(false));
        self.tasks.lock().await.insert(
            id,
            LiveTransfer {
                info: info.clone(),
                cancel: Some(tx),
                pause_flag: pause_flag.clone(),
            },
        );
        crate::log_info!(
            crate::logs::categories::TRANSFER, "download queued",
            "transfer": id.to_string(),
            "session": conn_id.to_string(),
            "remote": info.remote_path,
            "local": info.local_path,
        );
        let _ = app.emit(EV_STARTED, &info);
        let tasks_clone = self.tasks.clone();
        tokio::spawn(task::run_download(
            app,
            tasks_clone,
            id,
            remote,
            local,
            rx,
            pause_flag,
            session_mgr,
            conn_id,
            self.gate_handle(Direction::Download),
        ));
        id
    }

    /// FTP twin of `start_upload`: the task carries connection
    /// parameters rather than a session id, and opens its own connection
    /// once it holds a queue slot. Everything else — registration, the
    /// events, cancel, pause, the concurrency gate — is shared.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_ftp_upload(
        &self,
        app: AppHandle,
        spec: crate::ftp::client::FtpSpec,
        host_id: ConnectionId,
        local: PathBuf,
        remote: String,
        group_id: Option<TransferId>,
        expected_bytes: u64,
    ) -> TransferId {
        let id = Uuid::new_v4();
        let (tx, rx) = oneshot::channel();
        let info = TransferInfo {
            id,
            connection_id: host_id,
            direction: Direction::Upload,
            local_path: local.to_string_lossy().into_owned(),
            remote_path: remote.clone(),
            // The walk that spawned this knows the size already; a task
            // corrects it when it starts. 0 stays 0 only for a caller
            // that genuinely does not know.
            total_bytes: expected_bytes,
            bytes_done: 0,
            state: TransferState::Queued,
            started_at: Self::now_ms(),
            group_id,
        };
        let pause_flag = Arc::new(AtomicBool::new(false));
        self.tasks.lock().await.insert(
            id,
            LiveTransfer { info: info.clone(), cancel: Some(tx), pause_flag: pause_flag.clone() },
        );
        crate::log_info!(
            crate::logs::categories::TRANSFER, "ftp upload queued",
            "transfer": id.to_string(),
            "host": spec.host,
            "local": info.local_path,
            "remote": info.remote_path,
        );
        let _ = app.emit(EV_STARTED, &info);
        tokio::spawn(ftp_task::run_ftp_upload(
            app, self.tasks.clone(), id, spec, local, remote, rx, pause_flag,
            self.gate_handle(Direction::Upload),
        ));
        id
    }

    /// FTP twin of `start_download`; see `start_ftp_upload`.
    #[allow(clippy::too_many_arguments)]
    pub async fn start_ftp_download(
        &self,
        app: AppHandle,
        spec: crate::ftp::client::FtpSpec,
        host_id: ConnectionId,
        remote: String,
        local: PathBuf,
        group_id: Option<TransferId>,
        expected_bytes: u64,
    ) -> TransferId {
        let id = Uuid::new_v4();
        let (tx, rx) = oneshot::channel();
        let info = TransferInfo {
            id,
            connection_id: host_id,
            direction: Direction::Download,
            local_path: local.to_string_lossy().into_owned(),
            remote_path: remote.clone(),
            // The walk that spawned this knows the size already; a task
            // corrects it when it starts. 0 stays 0 only for a caller
            // that genuinely does not know.
            total_bytes: expected_bytes,
            bytes_done: 0,
            state: TransferState::Queued,
            started_at: Self::now_ms(),
            group_id,
        };
        let pause_flag = Arc::new(AtomicBool::new(false));
        self.tasks.lock().await.insert(
            id,
            LiveTransfer { info: info.clone(), cancel: Some(tx), pause_flag: pause_flag.clone() },
        );
        crate::log_info!(
            crate::logs::categories::TRANSFER, "ftp download queued",
            "transfer": id.to_string(),
            "host": spec.host,
            "remote": info.remote_path,
            "local": info.local_path,
        );
        let _ = app.emit(EV_STARTED, &info);
        tokio::spawn(ftp_task::run_ftp_download(
            app, self.tasks.clone(), id, spec, remote, local, rx, pause_flag,
            self.gate_handle(Direction::Download),
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
            group_id: None,
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
                pause_flag: Arc::new(AtomicBool::new(false)),
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
                pause_flag: Arc::new(AtomicBool::new(false)),
            },
        );
        mgr.cancel(id).await.unwrap();
        assert_eq!(mgr.list().await.len(), 1);
    }
}

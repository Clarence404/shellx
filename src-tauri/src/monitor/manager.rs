use crate::protocol::RusshHandle;
use crate::session::ConnectionId;
use std::collections::HashMap;
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::time::Duration;

pub struct MonitorManager {
    tasks: Mutex<HashMap<ConnectionId, tokio::task::AbortHandle>>,
}

impl MonitorManager {
    pub fn new() -> Self {
        Self {
            tasks: Mutex::new(HashMap::new()),
        }
    }

    /// Start (or restart) a poll loop for `conn_id`. If a loop is already
    /// running for this connection it is aborted first.
    pub async fn start(&self, conn_id: ConnectionId, handle: RusshHandle, app: AppHandle, interval: Duration) {
        let mut map = self.tasks.lock().await;
        if let Some(old) = map.remove(&conn_id) {
            old.abort();
        }
        let abort = super::start_poll_loop(conn_id.to_string(), handle, app, interval);
        map.insert(conn_id, abort);
    }

    /// Stop the poll loop for `conn_id`, if one is running.
    pub async fn stop(&self, conn_id: ConnectionId) {
        let mut map = self.tasks.lock().await;
        if let Some(handle) = map.remove(&conn_id) {
            handle.abort();
        }
    }
}

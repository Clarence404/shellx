use crate::error::{Error, Result};
use crate::monitor::manager::MonitorManager;
use crate::monitor::DEFAULT_POLL_INTERVAL;
use crate::session::manager::SessionManager;
use tauri::{AppHandle, State};
use tokio::time::Duration;

#[tauri::command]
pub async fn monitor_start(
    conn_id: String,
    interval_secs: Option<u64>,
    mgr_state: State<'_, MonitorManager>,
    session_mgr: State<'_, SessionManager>,
    app: AppHandle,
) -> Result<()> {
    let id = uuid::Uuid::parse_str(&conn_id)
        .map_err(|e| Error::Protocol(format!("invalid conn_id: {e}")))?;
    let ssh_handle = session_mgr
        .get_ssh_handle(id)
        .await
        .ok_or_else(|| Error::Protocol("session not found or not SSH".into()))?;
    let interval = interval_secs
        .map(|s| Duration::from_secs(s.max(1)))
        .unwrap_or(DEFAULT_POLL_INTERVAL);
    crate::log_info!(
        crate::logs::categories::MONITOR, "monitor poll loop started",
        "session": id.to_string(),
        "interval_secs": interval.as_secs(),
    );
    mgr_state.start(id, ssh_handle, app, interval).await;
    Ok(())
}

#[tauri::command]
pub async fn monitor_stop(
    conn_id: String,
    mgr_state: State<'_, MonitorManager>,
) -> Result<()> {
    let id = uuid::Uuid::parse_str(&conn_id)
        .map_err(|e| Error::Protocol(format!("invalid conn_id: {e}")))?;
    crate::log_info!(
        crate::logs::categories::MONITOR, "monitor poll loop stopped",
        "session": id.to_string(),
    );
    mgr_state.stop(id).await;
    Ok(())
}

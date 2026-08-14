use crate::error::{Error, Result};
use crate::monitor::manager::MonitorManager;
use crate::session::manager::SessionManager;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn monitor_start(
    conn_id: String,
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
    mgr_state.start(id, ssh_handle, app).await;
    Ok(())
}

#[tauri::command]
pub async fn monitor_stop(
    conn_id: String,
    mgr_state: State<'_, MonitorManager>,
) -> Result<()> {
    let id = uuid::Uuid::parse_str(&conn_id)
        .map_err(|e| Error::Protocol(format!("invalid conn_id: {e}")))?;
    mgr_state.stop(id).await;
    Ok(())
}

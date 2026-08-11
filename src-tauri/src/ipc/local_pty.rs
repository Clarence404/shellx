//! IPC commands for opening and closing local PTY terminal sessions.

use crate::error::Result;
use crate::session::manager::SessionManager;
use crate::session::{ConnectionInfo, SessionId};
use crate::settings::SettingsStore;
use events::{ClosedEvent, DataEvent, EV_CLOSED, EV_DATA};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use super::events;

/// Default shell per platform when `settings.local_shell` is None or empty.
fn default_shell() -> String {
    #[cfg(windows)]
    return "cmd.exe".into();
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

#[tauri::command]
pub async fn open_local_terminal(
    app: AppHandle,
    mgr: State<'_, SessionManager>,
    settings: State<'_, SettingsStore>,
) -> Result<ConnectionInfo> {
    let shell = settings
        .load()
        .ok()
        .flatten()
        .and_then(|s| s.local_shell.filter(|s| !s.is_empty()))
        .unwrap_or_else(default_shell);

    let info = mgr
        .open_local_session(&shell, "Local Terminal".into(), app.clone())
        .await?;

    let id = info.id;
    let mut rx = mgr.subscribe(id).await?;
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = app_clone.emit(EV_DATA, DataEvent { id, data: chunk });
        }
        let _ = app_clone.emit(EV_CLOSED, ClosedEvent { id, reason: "eof".into() });
    });

    Ok(info)
}

#[derive(Deserialize)]
pub struct CloseLocalArgs {
    pub id: SessionId,
}

#[tauri::command]
pub async fn close_local_terminal(
    args: CloseLocalArgs,
    mgr: State<'_, SessionManager>,
) -> Result<()> {
    mgr.close(args.id).await
}

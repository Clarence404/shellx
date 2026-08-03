//! Tauri IPC surface: commands the frontend invokes plus the bridge that
//! forwards each session's byte stream to the frontend as events.

pub mod events;
pub mod hosts;

use crate::error::Result;
use crate::protocol::{AuthConfig, AuthMethod};
use crate::session::manager::SessionManager;
use crate::session::{SessionId, SessionInfo};
use events::{ClosedEvent, DataEvent, EV_CLOSED, EV_DATA};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Deserialize)]
pub struct OpenSshArgs {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub label: String,
}

/// Opens an SSH session, then spawns a background task that pumps bytes
/// read from the session into `session:data` events until the driver loop
/// exits, at which point a single `session:closed` event is emitted.
#[tauri::command]
pub async fn open_ssh_session(
    args: OpenSshArgs,
    app: AppHandle,
    mgr: State<'_, SessionManager>,
) -> Result<SessionInfo> {
    let auth = AuthConfig {
        username: args.username,
        method: AuthMethod::Password(args.password),
    };
    let info = mgr
        .open_ssh(&args.host, args.port, auth, args.label)
        .await?;

    let id = info.id;
    let mut rx = mgr.subscribe(id).await?;
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = app_clone.emit(EV_DATA, DataEvent { id, data: chunk });
        }
        let _ = app_clone.emit(
            EV_CLOSED,
            ClosedEvent {
                id,
                reason: "eof".into(),
            },
        );
    });

    Ok(info)
}

#[derive(Deserialize)]
pub struct WriteArgs {
    pub id: SessionId,
    pub data: Vec<u8>,
}

#[tauri::command]
pub async fn write_session_input(args: WriteArgs, mgr: State<'_, SessionManager>) -> Result<()> {
    mgr.write(args.id, &args.data).await
}

#[derive(Deserialize)]
pub struct ResizeArgs {
    pub id: SessionId,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub async fn resize_session(args: ResizeArgs, mgr: State<'_, SessionManager>) -> Result<()> {
    mgr.resize(args.id, args.cols, args.rows).await
}

#[derive(Deserialize)]
pub struct CloseArgs {
    pub id: SessionId,
}

#[tauri::command]
pub async fn close_session(args: CloseArgs, mgr: State<'_, SessionManager>) -> Result<()> {
    mgr.close(args.id).await
}

#[tauri::command]
pub async fn list_sessions(mgr: State<'_, SessionManager>) -> Result<Vec<SessionInfo>> {
    Ok(mgr.list().await)
}

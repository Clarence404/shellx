//! Tauri IPC surface: commands the frontend invokes plus the bridge that
//! forwards each connection's byte stream to the frontend as events.

pub mod config;
pub mod events;
pub mod hosts;
pub mod local;
pub mod settings;
pub mod sftp;
pub mod transfer;

use crate::error::Result;
use crate::protocol::{AuthConfig, AuthMethod};
use crate::session::manager::SessionManager;
use crate::session::{ConnectionInfo, SessionId};
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
    pub host_id: Option<uuid::Uuid>,
}

/// Opens an SSH connection and eagerly opens its shell channel (matching
/// v0.2's UX, where connecting always lands you in a terminal), then spawns
/// a background task that pumps bytes read from the shell into
/// `session:data` events until the driver loop exits, at which point a
/// single `connection:closed` event is emitted.
#[tauri::command]
pub async fn open_connection(
    args: OpenSshArgs,
    app: AppHandle,
    mgr: State<'_, SessionManager>,
    host_store: State<'_, crate::store::HostStore>,
) -> Result<ConnectionInfo> {
    let auth = AuthConfig {
        username: args.username,
        method: AuthMethod::Password(args.password),
    };
    let info = mgr
        .open_connection(&args.host, args.port, auth, args.label, args.host_id)
        .await?;
    if let Err(e) = mgr.open_shell(info.id).await {
        // open_connection already parked a LiveConnection (with its
        // authenticated transport + keepalive) in the map; without this,
        // a shell-open failure (e.g. sshd rejecting the shell subsystem)
        // leaks it there for the process lifetime since the frontend never
        // receives an `info.id` to call close_connection with.
        let _ = mgr.close(info.id).await;
        return Err(e);
    }

    // Best-effort: record that this saved host was just connected to.
    if let Some(hid) = args.host_id {
        let _ = host_store.touch_last_connected(hid).await;
    }

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
pub struct OpenShellArgs {
    pub id: SessionId,
}

/// Opens the shell channel on an already-established connection. Not used
/// by the current UI (`open_connection` opens the shell eagerly) but
/// available for future flows (e.g. Task 4's "go straight to Files")
/// that establish a connection without immediately needing a terminal.
#[tauri::command]
pub async fn open_shell(args: OpenShellArgs, mgr: State<'_, SessionManager>) -> Result<()> {
    mgr.open_shell(args.id).await
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
pub async fn close_connection(args: CloseArgs, mgr: State<'_, SessionManager>) -> Result<()> {
    mgr.close(args.id).await
}

#[tauri::command]
pub async fn list_sessions(mgr: State<'_, SessionManager>) -> Result<Vec<ConnectionInfo>> {
    Ok(mgr.list().await)
}

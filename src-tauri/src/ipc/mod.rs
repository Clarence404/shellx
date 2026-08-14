//! Tauri IPC surface: commands the frontend invokes plus the bridge that
//! forwards each connection's byte stream to the frontend as events.

pub mod config;
pub mod events;
pub mod hostkeys;
pub mod hosts;
pub mod keys;
pub mod local;
pub mod local_pty;
pub mod monitor;
pub mod settings;
pub mod sftp;
pub mod transfer;
pub mod tunnels;

use crate::error::Result;
use crate::protocol::{AuthConfig, AuthMethod};
use crate::session::manager::SessionManager;
use crate::session::{ConnectionInfo, SessionId};
use crate::store::TunnelStore;
use events::{ClosedEvent, DataEvent, EV_CLOSED, EV_DATA};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Deserialize)]
pub struct OpenSshArgs {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub label: String,
    pub host_id: Option<uuid::Uuid>,
    pub auth_method: Option<String>,   // None|"password" → password; "publickey" → key
    pub key_path: Option<String>,
    pub passphrase: Option<String>,
    /// Override connection mode. When host_id is set, the stored mode is
    /// used and this field is ignored; for unsaved connections it defaults
    /// to "terminal_only".
    pub connection_mode: Option<String>,
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
    tunnel_store: State<'_, TunnelStore>,
) -> Result<ConnectionInfo> {
    let auth = match args.auth_method.as_deref() {
        Some("publickey") => {
            let path = args.key_path.clone()
                .ok_or_else(|| crate::error::Error::Protocol("publickey auth requires key_path".into()))?;
            AuthConfig {
                username: args.username.clone(),
                method: AuthMethod::Key { path, passphrase: args.passphrase.clone() },
            }
        }
        _ => AuthConfig {
            username: args.username.clone(),
            method: AuthMethod::Password(args.password.clone()),
        },
    };
    let policy = Arc::new(hostkeys::TofuPolicy { app: app.clone() });
    let info = mgr
        .open_connection(&args.host, args.port, auth, args.label, args.host_id, policy)
        .await?;

    // Determine effective connection_mode: prefer the stored host's mode when
    // host_id is set; otherwise fall back to args.connection_mode or the
    // hard default "terminal_only".
    let mode = if let Some(hid) = args.host_id {
        host_store.get(hid).await.ok().flatten()
            .map(|h| h.connection_mode.clone())
            .unwrap_or_else(|| "terminal_only".into())
    } else {
        args.connection_mode.clone().unwrap_or_else(|| "terminal_only".into())
    };

    match mode.as_str() {
        "tunnels_only" => {
            // No shell. Start all enabled tunnels.
            if let Some(hid) = args.host_id {
                let rules = tunnel_store.list_for_host(hid).await.unwrap_or_default();
                for rule in rules.into_iter().filter(|r| r.enabled) {
                    let _ = mgr.open_tunnel(info.id, rule.id.to_string(), rule.local_port, rule.remote_host, rule.remote_port, rule.bind_all, app.clone()).await;
                }
            }
            // There is no ShellDriver for tunnels_only, so nothing would
            // normally emit EV_CLOSED if the SSH transport dies. Spawn a
            // lightweight keepalive monitor that probes the transport every
            // 15 seconds; on failure it calls mgr.close() which drops the
            // subscription sender, causing the subscriber task below to see
            // rx.recv() == None and fire EV_CLOSED naturally.
            let mgr_monitor: SessionManager = (*mgr).clone();
            if let Some(ssh_handle) = mgr.get_ssh_handle(info.id).await {
                let monitor_id = info.id;
                tokio::spawn(async move {
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
                        // Check if the session was already closed by the user.
                        if mgr_monitor.get_ssh_handle(monitor_id).await.is_none() {
                            break;
                        }
                        // Probe transport liveness by opening a null session
                        // channel. When the SSH transport is dead this fails
                        // immediately; when alive we close the probe channel.
                        let probe = tokio::time::timeout(
                            tokio::time::Duration::from_secs(10),
                            ssh_handle.channel_open_session(),
                        )
                        .await;
                        match probe {
                            Ok(Ok(ch)) => {
                                // Transport alive — close the probe channel.
                                let _ = ch.close().await;
                            }
                            _ => {
                                // Transport dead or timed out; trigger EV_CLOSED.
                                let _ = mgr_monitor.close(monitor_id).await;
                                break;
                            }
                        }
                    }
                });
            }
        }
        "term_tunnels" => {
            // Shell + tunnels.
            if let Err(e) = mgr.open_shell(info.id).await {
                let _ = mgr.close(info.id).await;
                return Err(e);
            }
            if let Some(hid) = args.host_id {
                let rules = tunnel_store.list_for_host(hid).await.unwrap_or_default();
                for rule in rules.into_iter().filter(|r| r.enabled) {
                    let _ = mgr.open_tunnel(info.id, rule.id.to_string(), rule.local_port, rule.remote_host, rule.remote_port, rule.bind_all, app.clone()).await;
                }
            }
        }
        _ => {
            // terminal_only (default): open shell only, no tunnels.
            if let Err(e) = mgr.open_shell(info.id).await {
                // open_connection already parked a LiveConnection (with its
                // authenticated transport + keepalive) in the map; without this,
                // a shell-open failure (e.g. sshd rejecting the shell subsystem)
                // leaks it there for the process lifetime since the frontend never
                // receives an `info.id` to call close_connection with.
                let _ = mgr.close(info.id).await;
                return Err(e);
            }
        }
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

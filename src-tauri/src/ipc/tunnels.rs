use crate::error::{Error, Result};
use crate::protocol::{AuthConfig, AuthMethod};
use crate::session::manager::SessionManager;
use crate::store::{HostStore, KeychainStore, NewTunnelRule, TunnelRule, TunnelStore, UpdateTunnelRule};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[tauri::command]
pub async fn tunnel_list_for_host(
    host_id: Uuid,
    store: State<'_, TunnelStore>,
) -> Result<Vec<TunnelRule>> {
    store.list_for_host(host_id).await
}

#[tauri::command]
pub async fn tunnel_add(
    rule: NewTunnelRule,
    store: State<'_, TunnelStore>,
) -> Result<TunnelRule> {
    store.insert(rule).await
}

#[tauri::command]
pub async fn tunnel_update(
    rule: UpdateTunnelRule,
    store: State<'_, TunnelStore>,
) -> Result<()> {
    store.update(rule).await
}

#[derive(Deserialize)]
pub struct DeleteArgs {
    pub id: Uuid,
}

#[tauri::command]
pub async fn tunnel_delete(
    args: DeleteArgs,
    store: State<'_, TunnelStore>,
) -> Result<()> {
    store.delete(args.id).await
}

// ---------------------------------------------------------------------------
// Live tunnel control: open / close / add_session
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct TunnelOpenArgs {
    pub session_id: Uuid,
    pub rule_id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub bind_all: Option<bool>,
}

#[tauri::command]
pub async fn tunnel_open(
    args: TunnelOpenArgs,
    mgr: State<'_, SessionManager>,
    app: AppHandle,
) -> Result<()> {
    mgr.open_tunnel(
        args.session_id,
        args.rule_id,
        args.local_port,
        args.remote_host,
        args.remote_port,
        args.bind_all.unwrap_or(false),
        app,
    )
    .await
}

#[derive(Deserialize)]
pub struct TunnelCloseArgs {
    pub session_id: Uuid,
    pub rule_id: String,
}

#[tauri::command]
pub async fn tunnel_close(
    args: TunnelCloseArgs,
    mgr: State<'_, SessionManager>,
) -> Result<()> {
    mgr.close_tunnel(args.session_id, &args.rule_id).await
}

#[derive(Deserialize)]
pub struct ReorderArgs {
    pub host_id: Uuid,
    pub rule_ids: Vec<Uuid>,
}

#[tauri::command]
pub async fn tunnel_reorder(
    args: ReorderArgs,
    store: State<'_, TunnelStore>,
) -> Result<()> {
    store.reorder(args.host_id, &args.rule_ids).await
}

/// Open a tunnel for a saved host without requiring an interactive
/// terminal session. If a live SSH session already exists for the host
/// (from the Hosts panel) the tunnel rides on it; otherwise this command
/// opens a fresh SSH transport (using stored credentials from the
/// keychain), attaches a keepalive monitor, then opens the tunnel
/// channel. Returns the session id so the frontend can address later
/// close / status lookups. The tunnel-only session is NOT emitted to
/// the frontend sessions list, matching Termius' independent-tunnel UX.
#[derive(Deserialize)]
pub struct TunnelOpenViaHostArgs {
    pub host_id: Uuid,
    pub rule_id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub bind_all: Option<bool>,
}

#[derive(Serialize)]
pub struct TunnelOpenViaHostResult {
    pub session_id: Uuid,
    pub reused_session: bool,
}

#[tauri::command]
pub async fn tunnel_open_via_host(
    args: TunnelOpenViaHostArgs,
    mgr: State<'_, SessionManager>,
    host_store: State<'_, HostStore>,
    keychain: State<'_, KeychainStore>,
    app: AppHandle,
) -> Result<TunnelOpenViaHostResult> {
    let bind_addr = if args.bind_all.unwrap_or(false) { "0.0.0.0" } else { "127.0.0.1" };
    let local = format!("{bind_addr}:{}", args.local_port);
    let remote = format!("{}:{}", args.remote_host, args.remote_port);

    // Path 1: piggy-back on an already-open SSH session for the host.
    if let Some(session_id) = mgr.find_ssh_by_host(args.host_id).await {
        // A session can stay in the map marked Active long after its
        // transport is gone (laptop slept, idle NAT/firewall dropped the
        // flow). Reusing it binds the local port happily and then fails
        // every forwarded connection, which reads to the user as "the
        // tunnel is up but nothing connects". Probe first; on a dead
        // transport, retire the session and dial a fresh one below.
        if !transport_alive(&mgr, session_id).await {
            crate::log_warn!(
                crate::logs::categories::TUNNEL,
                "reusable ssh session failed liveness probe, dialing a fresh transport",
                "rule_id": args.rule_id,
                "host_id": args.host_id.to_string(),
                "session": session_id.to_string(),
            );
            let _ = mgr.close(session_id).await;
            return open_via_fresh_transport(args, mgr, host_store, keychain, app, &local, &remote).await;
        }
        mgr.open_tunnel(
            session_id,
            args.rule_id.clone(),
            args.local_port,
            args.remote_host.clone(),
            args.remote_port,
            args.bind_all.unwrap_or(false),
            app,
        )
        .await?;
        crate::log_info!(
            crate::logs::categories::TUNNEL,
            "tunnel started on existing ssh session",
            "rule_id": args.rule_id,
            "host_id": args.host_id.to_string(),
            "local": local,
            "remote": remote,
            "session": session_id.to_string(),
            "reused_session": true,
        );
        return Ok(TunnelOpenViaHostResult { session_id, reused_session: true });
    }

    // Path 2: no live session — open a fresh tunnel-only SSH transport.
    open_via_fresh_transport(args, mgr, host_store, keychain, app, &local, &remote).await
}

/// Is this session's SSH transport still usable? Opens and immediately
/// closes a throwaway channel — the same probe the tunnel keepalive
/// monitor uses, with a short timeout so a black-holed connection fails
/// fast instead of hanging the caller.
async fn transport_alive(mgr: &SessionManager, session_id: Uuid) -> bool {
    let Some(ssh) = mgr.get_ssh_handle(session_id).await else { return false };
    match tokio::time::timeout(
        tokio::time::Duration::from_secs(5),
        ssh.channel_open_session(),
    )
    .await
    {
        Ok(Ok(ch)) => {
            let _ = ch.close().await;
            true
        }
        _ => false,
    }
}

/// Dial a fresh tunnel-only SSH transport for `host_id` and open the
/// tunnel on it. Used when no session exists for the host, or when the
/// existing one turned out to be dead.
async fn open_via_fresh_transport(
    args: TunnelOpenViaHostArgs,
    mgr: State<'_, SessionManager>,
    host_store: State<'_, HostStore>,
    keychain: State<'_, KeychainStore>,
    app: AppHandle,
    local: &str,
    remote: &str,
) -> Result<TunnelOpenViaHostResult> {
    let host = host_store
        .get(args.host_id)
        .await
        .map_err(|e| Error::Protocol(format!("host lookup failed: {e}")))?
        .ok_or_else(|| Error::Protocol("saved host not found".into()))?;

    let auth = match host.auth_method.as_str() {
        "publickey" => {
            let path = host
                .key_path
                .clone()
                .ok_or_else(|| Error::Protocol("host is publickey-auth but has no key_path".into()))?;
            let passphrase = keychain.get_passphrase(args.host_id).ok().flatten();
            AuthConfig {
                username: host.username.clone(),
                method: AuthMethod::Key { path, passphrase },
            }
        }
        _ => {
            let password = keychain
                .get_password(args.host_id)
                .ok()
                .flatten()
                .ok_or_else(|| Error::Protocol(
                    "no saved password for host; connect from the Hosts panel once so the credentials are cached".into()
                ))?;
            AuthConfig {
                username: host.username.clone(),
                method: AuthMethod::Password(password),
            }
        }
    };

    let policy: Arc<dyn crate::protocol::HostKeyPolicy> =
        Arc::new(crate::ipc::hostkeys::TofuPolicy { app: app.clone() });
    let info = mgr
        .open_connection(&host.host, host.port, auth, host.label.clone(), Some(args.host_id), policy)
        .await?;

    // Subscribe so a transport-side close reaches App.tsx as an EV_CLOSED
    // event; without this the silent session would linger forever after
    // the SSH transport drops. App.tsx already ignores closed events for
    // ids not in its own sessions list, so this is safe for tunnel-only.
    if let Ok(mut rx) = mgr.subscribe(info.id).await {
        let app_close = app.clone();
        let id = info.id;
        tokio::spawn(async move {
            // Silently drain until the channel closes; nothing to render.
            while rx.recv().await.is_some() {}
            let _ = app_close.emit(
                "connection:closed",
                serde_json::json!({ "id": id, "reason": "eof" }),
            );
        });
    }

    // Same 15s keepalive probe used by tunnels_only mode in
    // ipc::open_connection — if the transport dies mid-tunnel, kick
    // the SessionManager so it emits EV_CLOSED and cleans up.
    let mgr_monitor: SessionManager = (*mgr).clone();
    if let Some(ssh_handle) = mgr.get_ssh_handle(info.id).await {
        let monitor_id = info.id;
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
                if mgr_monitor.get_ssh_handle(monitor_id).await.is_none() {
                    break;
                }
                let probe = tokio::time::timeout(
                    tokio::time::Duration::from_secs(10),
                    ssh_handle.channel_open_session(),
                )
                .await;
                match probe {
                    Ok(Ok(ch)) => { let _ = ch.close().await; }
                    _ => {
                        let _ = mgr_monitor.close(monitor_id).await;
                        break;
                    }
                }
            }
        });
    }

    mgr.open_tunnel(
        info.id,
        args.rule_id.clone(),
        args.local_port,
        args.remote_host.clone(),
        args.remote_port,
        args.bind_all.unwrap_or(false),
        app,
    )
    .await?;

    crate::log_info!(
        crate::logs::categories::TUNNEL,
        "tunnel started via saved host",
        "rule_id": args.rule_id,
        "host_id": args.host_id.to_string(),
        "local": local,
        "remote": remote,
        "session": info.id.to_string(),
        "reused_session": false,
    );

    Ok(TunnelOpenViaHostResult { session_id: info.id, reused_session: false })
}

/// Add a session-only tunnel (not persisted to DB).
/// Opens the tunnel immediately and returns its ephemeral rule_id.
#[derive(Deserialize)]
pub struct TunnelAddSessionArgs {
    pub session_id: Uuid,
    pub label: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Serialize)]
pub struct SessionTunnelInfo {
    pub rule_id: String,
    pub session_id: Uuid,
    pub label: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub session_only: bool,
}

#[tauri::command]
pub async fn tunnel_add_session(
    args: TunnelAddSessionArgs,
    mgr: State<'_, SessionManager>,
    app: AppHandle,
) -> Result<SessionTunnelInfo> {
    let rule_id = Uuid::new_v4().to_string();
    mgr.open_tunnel(
        args.session_id,
        rule_id.clone(),
        args.local_port,
        args.remote_host.clone(),
        args.remote_port,
        false,
        app,
    )
    .await?;
    Ok(SessionTunnelInfo {
        rule_id,
        session_id: args.session_id,
        label: args.label,
        local_port: args.local_port,
        remote_host: args.remote_host,
        remote_port: args.remote_port,
        session_only: true,
    })
}

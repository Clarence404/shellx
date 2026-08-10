use crate::error::Result;
use crate::session::manager::SessionManager;
use crate::store::{NewTunnelRule, TunnelRule, TunnelStore, UpdateTunnelRule};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
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

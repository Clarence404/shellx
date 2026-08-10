use crate::error::Result;
use crate::store::{NewTunnelRule, TunnelRule, TunnelStore, UpdateTunnelRule};
use serde::Deserialize;
use tauri::State;
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

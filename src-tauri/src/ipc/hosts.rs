//! Tauri IPC commands for host CRUD and OS-keychain-backed password storage.

use crate::error::Result;
use crate::store::{HostRecord, HostStore, HostUpdate, KeychainStore, NewHost};
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct SaveHostArgs {
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub notes: Option<String>,
    pub password: Option<String>, // non-empty = store in keychain
}

#[derive(Deserialize)]
pub struct UpdateHostArgs {
    pub id: Uuid,
    pub label: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    #[serde(default, deserialize_with = "crate::store::hosts::double_option_deserialize")]
    pub notes: Option<Option<String>>,
    // Three-state: absent = leave unchanged; null = delete keychain entry; string = set new
    #[serde(default, deserialize_with = "crate::store::hosts::double_option_deserialize")]
    pub password: Option<Option<String>>,
}

#[derive(Deserialize)]
pub struct DeleteHostArgs {
    pub id: Uuid,
}

#[derive(Deserialize)]
pub struct GetHostPasswordArgs {
    pub id: Uuid,
}

#[tauri::command]
pub async fn list_hosts(store: State<'_, HostStore>) -> Result<Vec<HostRecord>> {
    store.list().await
}

#[tauri::command]
pub async fn save_host(
    args: SaveHostArgs,
    store: State<'_, HostStore>,
    keychain: State<'_, KeychainStore>,
) -> Result<HostRecord> {
    let record = store
        .insert(NewHost {
            label: args.label,
            host: args.host,
            port: args.port,
            username: args.username,
            notes: args.notes,
        })
        .await?;
    if let Some(pw) = args.password.filter(|p| !p.is_empty()) {
        // If keychain unavailable, ignore silently — the host was saved without password
        let _ = keychain.set_password(record.id, &pw);
    }
    Ok(record)
}

#[tauri::command]
pub async fn update_host(
    args: UpdateHostArgs,
    store: State<'_, HostStore>,
    keychain: State<'_, KeychainStore>,
) -> Result<HostRecord> {
    let updated = store
        .update(
            args.id,
            HostUpdate {
                label: args.label,
                host: args.host,
                port: args.port,
                username: args.username,
                notes: args.notes,
            },
        )
        .await?;
    match args.password {
        None => {} // absent — leave keychain unchanged
        Some(None) => {
            // null — delete
            let _ = keychain.delete_password(args.id);
        }
        Some(Some(pw)) if !pw.is_empty() => {
            let _ = keychain.set_password(args.id, &pw);
        }
        Some(Some(_)) => {} // empty string — treat as no-op
    }
    Ok(updated)
}

#[tauri::command]
pub async fn delete_host(
    args: DeleteHostArgs,
    store: State<'_, HostStore>,
    keychain: State<'_, KeychainStore>,
) -> Result<()> {
    store.delete(args.id).await?;
    let _ = keychain.delete_password(args.id);
    Ok(())
}

#[tauri::command]
pub async fn get_host_password(
    args: GetHostPasswordArgs,
    keychain: State<'_, KeychainStore>,
) -> Result<Option<String>> {
    keychain.get_password(args.id)
}

#[tauri::command]
pub fn keychain_available(keychain: State<'_, KeychainStore>) -> bool {
    keychain.is_available()
}

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
    pub auth_method: Option<String>,   // defaults to "password" when absent
    pub key_path: Option<String>,
    pub passphrase: Option<String>,    // store in keychain after successful insert
    pub connection_mode: Option<String>, // None defaults to "terminal_only"
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
    pub auth_method: Option<String>,
    #[serde(default, deserialize_with = "crate::store::hosts::double_option_deserialize")]
    pub key_path: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::store::hosts::double_option_deserialize")]
    pub passphrase: Option<Option<String>>,
    pub connection_mode: Option<String>,
}

#[derive(Deserialize)]
pub struct DeleteHostArgs {
    pub id: Uuid,
}

#[derive(Deserialize)]
pub struct GetHostPasswordArgs {
    pub id: Uuid,
}

/// Wraps a `HostRecord` with a flag indicating whether the intended
/// keychain password state (set/deleted/unchanged) was actually achieved.
/// `#[serde(flatten)]` keeps the JSON shape identical to `HostRecord` plus
/// one extra `password_stored: boolean` field.
#[derive(serde::Serialize)]
pub struct HostSaveResult {
    #[serde(flatten)]
    pub host: HostRecord,
    pub password_stored: bool,
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
) -> Result<HostSaveResult> {
    let record = store
        .insert(NewHost {
            label: args.label,
            host: args.host,
            port: args.port,
            username: args.username,
            notes: args.notes,
            auth_method: args.auth_method.unwrap_or_else(|| "password".to_string()),
            key_path: args.key_path,
            connection_mode: args.connection_mode,
        })
        .await?;
    let password_stored = match args.password.filter(|p| !p.is_empty()) {
        // Keychain write attempted — success reflects whether it actually landed.
        Some(pw) => keychain.set_password(record.id, &pw).is_ok(),
        // No password was supplied, so there is nothing to store — trivially satisfied.
        None => true,
    };
    // Passphrase: fire-and-forget; caller expects success after connect, not save.
    if let Some(pp) = args.passphrase.filter(|p| !p.is_empty()) {
        let _ = keychain.set_passphrase(record.id, &pp);
    }
    Ok(HostSaveResult { host: record, password_stored })
}

#[tauri::command]
pub async fn update_host(
    args: UpdateHostArgs,
    store: State<'_, HostStore>,
    keychain: State<'_, KeychainStore>,
) -> Result<HostSaveResult> {
    let updated = store
        .update(
            args.id,
            HostUpdate {
                label: args.label,
                host: args.host,
                port: args.port,
                username: args.username,
                notes: args.notes,
                auth_method: args.auth_method,
                key_path: args.key_path,
                connection_mode: args.connection_mode,
            },
        )
        .await?;
    // `password_stored` means "the intended keychain state was achieved" —
    // it is false only when a keychain write/delete we attempted failed.
    let password_stored = match args.password {
        None => true, // absent — leave keychain unchanged, nothing to do
        Some(None) => {
            // null — delete the stored password
            keychain.delete_password(args.id).is_ok()
        }
        Some(Some(pw)) if !pw.is_empty() => {
            keychain.set_password(args.id, &pw).is_ok()
        }
        Some(Some(_)) => true, // empty string — treat as no-op, unchanged
    };
    match args.passphrase {
        None => {}  // absent — leave unchanged
        Some(None) => { let _ = keychain.delete_passphrase(args.id); }
        Some(Some(pp)) if !pp.is_empty() => { let _ = keychain.set_passphrase(args.id, &pp).is_ok(); }
        Some(Some(_)) => {}  // empty string — no-op
    }
    Ok(HostSaveResult { host: updated, password_stored })
}

#[tauri::command]
pub async fn delete_host(
    args: DeleteHostArgs,
    store: State<'_, HostStore>,
    keychain: State<'_, KeychainStore>,
) -> Result<()> {
    store.delete(args.id).await?;
    let _ = keychain.delete_password(args.id);
    let _ = keychain.delete_passphrase(args.id);
    Ok(())
}

#[tauri::command]
pub async fn get_host_password(
    args: GetHostPasswordArgs,
    keychain: State<'_, KeychainStore>,
) -> Result<Option<String>> {
    keychain.get_password(args.id)
}

#[derive(Deserialize)]
pub struct GetHostPassphraseArgs {
    pub id: Uuid,
}

#[tauri::command]
pub async fn get_host_passphrase(
    args: GetHostPassphraseArgs,
    keychain: State<'_, KeychainStore>,
) -> Result<Option<String>> {
    keychain.get_passphrase(args.id)
}

#[derive(Deserialize)]
pub struct SetHostPassphraseArgs {
    pub id: Uuid,
    pub passphrase: String,
}

#[tauri::command]
pub async fn set_host_passphrase(
    args: SetHostPassphraseArgs,
    keychain: State<'_, KeychainStore>,
) -> crate::error::Result<()> {
    keychain.set_passphrase(args.id, &args.passphrase)
}

#[tauri::command]
pub fn keychain_available(keychain: State<'_, KeychainStore>) -> bool {
    keychain.is_available()
}

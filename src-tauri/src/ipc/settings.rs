//! Tauri IPC surface for user preferences (Settings). Reads/writes
//! settings.json next to hosts.db.

use crate::error::Result;
use crate::settings::{Settings, SettingsStore};
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub async fn load_settings(store: State<'_, SettingsStore>) -> Result<Option<Settings>> {
    store.load()
}

#[derive(Deserialize)]
pub struct SaveSettingsArgs {
    pub settings: Settings,
}

#[tauri::command]
pub async fn save_settings(
    args: SaveSettingsArgs,
    store: State<'_, SettingsStore>,
) -> Result<()> {
    store.save(&args.settings)
}

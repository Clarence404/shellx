//! Tauri IPC surface for user preferences (Settings). Reads/writes
//! settings.json next to hosts.db.

use crate::error::Result;
use crate::settings::{Settings, SettingsStore};
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub async fn load_settings(store: State<'_, SettingsStore>) -> Result<Option<Settings>> {
    store.load().map_err(|e| {
        crate::log_error!(
            crate::logs::categories::APP, "settings could not be read",
            "error": e.to_string(),
        );
        e
    })
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
    // A settings write that fails leaves the UI showing the new value and
    // the disk holding the old one — worth a line even though the command
    // does surface the error to the caller.
    store.save(&args.settings).map_err(|e| {
        crate::log_error!(
            crate::logs::categories::APP, "settings could not be saved",
            "error": e.to_string(),
        );
        e
    })
}

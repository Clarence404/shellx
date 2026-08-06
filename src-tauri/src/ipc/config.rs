//! IPC surface for exposing the resolved config directory to the
//! frontend (About panel displays it so users know where hosts.db /
//! settings.json actually live).

use crate::error::Result;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

/// Wrapper for the runtime-resolved config directory, so it can be
/// injected into commands as tauri managed state.
pub struct ConfigDir(pub PathBuf);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigPaths {
    pub config_dir: String,
    pub hosts_db: String,
    pub settings_json: String,
}

#[tauri::command]
pub async fn get_config_paths(cfg: State<'_, ConfigDir>) -> Result<ConfigPaths> {
    let dir = &cfg.0;
    Ok(ConfigPaths {
        config_dir: dir.display().to_string(),
        hosts_db: dir.join("hosts.db").display().to_string(),
        settings_json: dir.join("settings.json").display().to_string(),
    })
}

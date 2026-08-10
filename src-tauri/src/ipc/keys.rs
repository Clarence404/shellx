use crate::keys::{self, DiscoveredKey};

#[tauri::command]
pub fn keys_discover() -> Vec<DiscoveredKey> {
    dirs::home_dir()
        .map(|h| keys::discover(&h.join(".ssh")))
        .unwrap_or_default()
}

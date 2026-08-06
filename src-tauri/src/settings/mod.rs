use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme_id: String,
    pub density: String,
    /// Sans UI font family preset. Missing on old settings.json files
    /// (pre-v0.5.2) — serde default resolves to `"system-default"`.
    #[serde(default = "default_system_font")]
    pub system_font: String,
    /// Sans UI font size in px, 11..=16. Missing on old settings.json
    /// files (pre-v0.5.3) — serde default resolves to 13.
    #[serde(default = "default_system_font_size")]
    pub system_font_size: u32,
    /// Files-pane row font size in px, 11..=18. Missing on old
    /// settings.json files (pre-v0.5.8) — serde default resolves to 13.
    #[serde(default = "default_files_font_size")]
    pub files_font_size: u32,
    pub terminal: TerminalSettings,
    pub schema_version: u32,
}

fn default_system_font() -> String { "system-default".into() }
fn default_system_font_size() -> u32 { 13 }
fn default_files_font_size() -> u32 { 13 }

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    pub font_family: String,
    pub font_size: u32,
    pub cursor_style: String,
}

pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    pub fn open(config_dir: &Path) -> Self {
        std::fs::create_dir_all(config_dir).ok();
        Self {
            path: config_dir.join("settings.json"),
        }
    }

    pub fn load(&self) -> Result<Option<Settings>> {
        if !self.path.exists() {
            return Ok(None);
        }
        match std::fs::read_to_string(&self.path) {
            Ok(s) => match serde_json::from_str::<Settings>(&s) {
                Ok(settings) => Ok(Some(settings)),
                Err(e) => {
                    eprintln!("shellx: settings.json unreadable, using defaults: {e}");
                    Ok(None)
                }
            },
            Err(e) => {
                eprintln!("shellx: settings.json IO error, using defaults: {e}");
                Ok(None)
            }
        }
    }

    pub fn save(&self, settings: &Settings) -> Result<()> {
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| Error::Protocol(format!("serialize settings: {e}")))?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, &json)
            .map_err(|e| Error::Protocol(format!("write settings.tmp: {e}")))?;
        std::fs::rename(&tmp, &self.path)
            .map_err(|e| Error::Protocol(format!("rename settings.tmp -> settings.json: {e}")))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_settings() -> Settings {
        Settings {
            theme_id: "warm-light".into(),
            density: "compact".into(),
            system_font: "segoe-ui".into(),
            system_font_size: 14,
            files_font_size: 15,
            terminal: TerminalSettings {
                font_family: "fira-code".into(),
                font_size: 14,
                cursor_style: "underline".into(),
            },
            schema_version: 1,
        }
    }

    #[test]
    fn load_old_settings_json_without_system_font_uses_default() {
        // Pre-v0.5.2 settings.json didn't have systemFont / systemFontSize;
        // serde defaults resolve to "system-default" / 13 and load succeeds.
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        let legacy = r#"{"themeId":"warm-minimal","density":"compact","terminal":{"fontFamily":"fira-code","fontSize":14,"cursorStyle":"underline"},"schemaVersion":1}"#;
        std::fs::write(td.path().join("settings.json"), legacy).unwrap();
        let got = store.load().unwrap().unwrap();
        assert_eq!(got.system_font, "system-default");
        assert_eq!(got.system_font_size, 13);
        assert_eq!(got.files_font_size, 13);
    }

    #[test]
    fn load_returns_none_when_file_missing() {
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        assert!(store.load().unwrap().is_none());
    }

    #[test]
    fn save_then_load_roundtrips() {
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        let want = make_settings();
        store.save(&want).unwrap();
        let got = store.load().unwrap().unwrap();
        assert_eq!(want, got);
    }

    #[test]
    fn save_twice_overwrites() {
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        let mut s = make_settings();
        store.save(&s).unwrap();
        s.terminal.font_size = 18;
        store.save(&s).unwrap();
        let got = store.load().unwrap().unwrap();
        assert_eq!(got.terminal.font_size, 18);
    }

    #[test]
    fn load_returns_none_on_malformed_json() {
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        std::fs::write(td.path().join("settings.json"), "{ not valid json").unwrap();
        assert!(store.load().unwrap().is_none()); // graceful fallback, not an error
    }
}

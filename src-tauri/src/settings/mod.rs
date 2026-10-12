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
    /// Path or command for the local terminal shell.
    /// None → use platform default (cmd.exe on Windows, $SHELL on Unix).
    #[serde(default)]
    pub local_shell: Option<String>,
    /// External editor for "open remote file in editor". None → OS default.
    #[serde(default)]
    pub external_editor: Option<String>,
    /// Double-click a remote text file to edit it instead of downloading.
    #[serde(default)]
    pub double_click_edit: bool,
    /// UI language ("en" | "zh"). Missing on old settings.json files —
    /// serde default resolves to "en".
    #[serde(default = "default_language")]
    pub language: String,
    /// Check GitHub Releases for updates on startup. serde default: true.
    #[serde(default = "default_auto_update_check")]
    pub auto_update_check: bool,
    /// Monitor threshold alerts. Missing on settings.json files written
    /// before v0.36 — serde default resolves to `AlertSettings::default()`,
    /// which is switched off, so upgrading never starts alerting on its own.
    #[serde(default)]
    pub alerts: AlertSettings,
    /// Power-user tuning. Missing on settings.json files written before
    /// v0.20 — serde default resolves to `AdvancedSettings::default()`.
    #[serde(default)]
    pub advanced: AdvancedSettings,
    pub schema_version: u32,
}

fn default_system_font() -> String { "system-default".into() }
fn default_system_font_size() -> u32 { 13 }
fn default_files_font_size() -> u32 { 13 }
fn default_language() -> String { "en".into() }
fn default_auto_update_check() -> bool { true }

/// Global power-user knobs, surfaced in Settings → Advanced. Every field
/// has a serde default so a settings.json written by any earlier version
/// still loads, and every field is range-checked by `sanitized()` before
/// it reaches a consumer — a hand-edited file must not be able to wedge
/// the app (a zero SFTP concurrency would stall every transfer).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSettings {
    /// TCP+handshake budget before a connect attempt gives up, 5..=60.
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_secs: u32,
    /// SSH keepalive probe interval, 0..=300. 0 disables keepalives.
    #[serde(default = "default_keepalive_interval")]
    pub keepalive_interval_secs: u32,
    /// Unanswered keepalives before russh drops the transport, 1..=10.
    #[serde(default = "default_keepalive_max")]
    pub keepalive_max: u32,
    /// Concurrent SFTP transfers, 1..=16. Extra transfers queue.
    #[serde(default = "default_sftp_concurrency")]
    pub sftp_concurrency: u32,
    /// Minimum level recorded by the logs subsystem, applied at startup.
    #[serde(default = "default_log_level")]
    pub log_level: String,
    /// xterm scrollback lines for new terminals, 500..=50000.
    #[serde(default = "default_terminal_scrollback")]
    pub terminal_scrollback: u32,
    /// First tunnel auto-reconnect delay in seconds, 1..=60. Later
    /// attempts back off from here.
    #[serde(default = "default_reconnect_interval")]
    pub reconnect_interval_secs: u32,
    /// Tunnel auto-reconnect attempts before giving up, 0..=20.
    /// 0 means keep trying.
    #[serde(default = "default_reconnect_max_attempts")]
    pub reconnect_max_attempts: u32,
}

fn default_connect_timeout() -> u32 { 10 }
fn default_keepalive_interval() -> u32 { 60 }
fn default_keepalive_max() -> u32 { 3 }
fn default_sftp_concurrency() -> u32 { 4 }
fn default_log_level() -> String { "info".into() }
fn default_terminal_scrollback() -> u32 { 5000 }
fn default_reconnect_interval() -> u32 { 5 }
fn default_reconnect_max_attempts() -> u32 { 10 }

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self {
            connect_timeout_secs: default_connect_timeout(),
            keepalive_interval_secs: default_keepalive_interval(),
            keepalive_max: default_keepalive_max(),
            sftp_concurrency: default_sftp_concurrency(),
            log_level: default_log_level(),
            terminal_scrollback: default_terminal_scrollback(),
            reconnect_interval_secs: default_reconnect_interval(),
            reconnect_max_attempts: default_reconnect_max_attempts(),
        }
    }
}

impl AdvancedSettings {
    /// Clamp every field into the range its UI control offers, falling
    /// back to the default for an unrecognised log level. Consumers use
    /// this rather than the raw struct.
    pub fn sanitized(&self) -> Self {
        let log_level = match self.log_level.as_str() {
            "debug" | "info" | "warn" | "error" => self.log_level.clone(),
            _ => default_log_level(),
        };
        Self {
            connect_timeout_secs: self.connect_timeout_secs.clamp(5, 60),
            keepalive_interval_secs: self.keepalive_interval_secs.min(300),
            keepalive_max: self.keepalive_max.clamp(1, 10),
            sftp_concurrency: self.sftp_concurrency.clamp(1, 16),
            log_level,
            terminal_scrollback: self.terminal_scrollback.clamp(500, 50_000),
            reconnect_interval_secs: self.reconnect_interval_secs.clamp(1, 60),
            reconnect_max_attempts: self.reconnect_max_attempts.min(20),
        }
    }
}

/// One numeric alert rule, as Settings → Alerts presents it: a toggle
/// and the percentage (or load multiple) the metric must stay under.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlertThreshold {
    pub enabled: bool,
    pub value: f64,
}

impl AlertThreshold {
    fn new(enabled: bool, value: f64) -> Self {
        Self { enabled, value }
    }
    fn sanitized(&self, min: f64, max: f64) -> Self {
        Self {
            enabled: self.enabled,
            value: self.value.clamp(min, max),
        }
    }
}

/// Monitor threshold alerts, surfaced in Settings → Alerts. One global
/// set shared by every host. Like `AdvancedSettings`, every field has a
/// serde default and every number is range-checked by `sanitized()`, so
/// a hand-edited file cannot make the rules nonsensical.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlertSettings {
    /// Master switch. Off means no background sampling and no alerts.
    #[serde(default)]
    pub enabled: bool,
    /// Also raise an OS notification when an alert fires.
    #[serde(default = "default_true")]
    pub system_notifications: bool,
    #[serde(default = "default_cpu_rule")]
    pub cpu: AlertThreshold,
    #[serde(default = "default_memory_rule")]
    pub memory: AlertThreshold,
    #[serde(default = "default_disk_rule")]
    pub disk: AlertThreshold,
    #[serde(default = "default_swap_rule")]
    pub swap: AlertThreshold,
    /// 1-minute load average divided by core count.
    #[serde(default = "default_load_rule")]
    pub load_per_core: AlertThreshold,
    /// A unit entering `systemctl --failed` is its own alert.
    #[serde(default = "default_true")]
    pub failed_units: bool,
    /// Consecutive breaching samples before an alert fires, 1..=20.
    #[serde(default = "default_sustain_samples")]
    pub sustain_samples: u32,
    /// Minutes before the same rule may fire again, 1..=120.
    #[serde(default = "default_cooldown_mins")]
    pub cooldown_mins: u32,
}

fn default_true() -> bool { true }
fn default_cpu_rule() -> AlertThreshold { AlertThreshold::new(true, 85.0) }
fn default_memory_rule() -> AlertThreshold { AlertThreshold::new(true, 90.0) }
fn default_disk_rule() -> AlertThreshold { AlertThreshold::new(true, 90.0) }
fn default_swap_rule() -> AlertThreshold { AlertThreshold::new(false, 50.0) }
fn default_load_rule() -> AlertThreshold { AlertThreshold::new(false, 2.0) }
fn default_sustain_samples() -> u32 { 3 }
fn default_cooldown_mins() -> u32 { 10 }

impl Default for AlertSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            system_notifications: true,
            cpu: default_cpu_rule(),
            memory: default_memory_rule(),
            disk: default_disk_rule(),
            swap: default_swap_rule(),
            load_per_core: default_load_rule(),
            failed_units: true,
            sustain_samples: default_sustain_samples(),
            cooldown_mins: default_cooldown_mins(),
        }
    }
}

impl AlertSettings {
    /// Clamp every number into the range its UI control offers. Ranges
    /// must match ALERT_RANGES on the TypeScript side.
    pub fn sanitized(&self) -> Self {
        Self {
            enabled: self.enabled,
            system_notifications: self.system_notifications,
            cpu: self.cpu.sanitized(50.0, 100.0),
            memory: self.memory.sanitized(50.0, 100.0),
            disk: self.disk.sanitized(50.0, 100.0),
            swap: self.swap.sanitized(10.0, 100.0),
            load_per_core: self.load_per_core.sanitized(1.0, 10.0),
            failed_units: self.failed_units,
            sustain_samples: self.sustain_samples.clamp(1, 20),
            cooldown_mins: self.cooldown_mins.clamp(1, 120),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    pub font_family: String,
    pub font_size: u32,
    pub cursor_style: String,
    /// Inline command suggestions from locally recorded history.
    /// Defaulted for settings.json files written before the field existed.
    #[serde(default = "default_command_suggest")]
    pub command_suggest: bool,
}

fn default_command_suggest() -> bool {
    true
}

/// Read the sanitized `advanced` block, falling back to defaults when
/// settings.json is missing or unreadable. Every consumer goes through
/// here so nobody sees an unclamped value.
pub fn advanced_or_default(store: &SettingsStore) -> AdvancedSettings {
    store
        .load()
        .ok()
        .flatten()
        .map(|s| s.advanced)
        .unwrap_or_default()
        .sanitized()
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
                command_suggest: true,
            },
            local_shell: None,
            external_editor: None,
            double_click_edit: false,
            language: "en".into(),
            auto_update_check: true,
            alerts: Default::default(),
            advanced: AdvancedSettings::default(),
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
    fn legacy_settings_json_without_advanced_gets_defaults() {
        // Anything written before v0.20 has no `advanced` key at all.
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        let legacy = r#"{"themeId":"warm-light","density":"comfortable","terminal":{"fontFamily":"fira-code","fontSize":14,"cursorStyle":"block"},"schemaVersion":1}"#;
        std::fs::write(td.path().join("settings.json"), legacy).unwrap();
        let got = store.load().unwrap().unwrap();
        assert_eq!(got.advanced, AdvancedSettings::default());
        assert_eq!(got.advanced.sftp_concurrency, 4);
        assert_eq!(got.advanced.log_level, "info");
    }

    #[test]
    fn a_settings_json_without_alerts_gets_defaults_and_stays_quiet() {
        // Anything written before v0.36 has no `alerts` key. Upgrading
        // must not start alerting on its own, so the default is off.
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        let legacy = r#"{"themeId":"warm-light","density":"comfortable","terminal":{"fontFamily":"fira-code","fontSize":14,"cursorStyle":"block"},"schemaVersion":1}"#;
        std::fs::write(td.path().join("settings.json"), legacy).unwrap();
        let got = store.load().unwrap().unwrap();
        assert_eq!(got.alerts, AlertSettings::default());
        assert!(!got.alerts.enabled);
        assert_eq!(got.alerts.cpu.value, 85.0);
        assert_eq!(got.alerts.sustain_samples, 3);
    }

    #[test]
    fn alert_settings_sanitized_clamps_every_number() {
        let wild = AlertSettings {
            enabled: true,
            system_notifications: false,
            cpu: AlertThreshold::new(true, 400.0),
            memory: AlertThreshold::new(true, -5.0),
            disk: AlertThreshold::new(true, 95.0),
            swap: AlertThreshold::new(true, 0.0),
            load_per_core: AlertThreshold::new(true, 99.0),
            failed_units: true,
            sustain_samples: 0,
            cooldown_mins: 9999,
        };
        let got = wild.sanitized();
        assert_eq!(got.cpu.value, 100.0);
        assert_eq!(got.memory.value, 50.0);
        assert_eq!(got.disk.value, 95.0, "a value already in range is left alone");
        assert_eq!(got.swap.value, 10.0);
        assert_eq!(got.load_per_core.value, 10.0);
        assert_eq!(got.sustain_samples, 1);
        assert_eq!(got.cooldown_mins, 120);
        assert!(got.enabled, "clamping must not flip the switches");
        assert!(!got.system_notifications);
    }

    #[test]
    fn sanitized_clamps_out_of_range_values() {
        let wild = AdvancedSettings {
            connect_timeout_secs: 0,
            keepalive_interval_secs: 9_999,
            keepalive_max: 0,
            // A hand-edited 0 here would otherwise hand out no transfer
            // permits at all and stall the queue forever.
            sftp_concurrency: 0,
            log_level: "verbose".into(),
            terminal_scrollback: 1,
            reconnect_interval_secs: 0,
            reconnect_max_attempts: 999,
        };
        let s = wild.sanitized();
        assert_eq!(s.connect_timeout_secs, 5);
        assert_eq!(s.keepalive_interval_secs, 300);
        assert_eq!(s.keepalive_max, 1);
        assert_eq!(s.sftp_concurrency, 1);
        assert_eq!(s.log_level, "info");
        assert_eq!(s.terminal_scrollback, 500);
        assert_eq!(s.reconnect_interval_secs, 1);
        assert_eq!(s.reconnect_max_attempts, 20);
    }

    #[test]
    fn sanitized_keeps_a_disabled_keepalive_disabled() {
        let off = AdvancedSettings { keepalive_interval_secs: 0, ..Default::default() };
        assert_eq!(off.sanitized().keepalive_interval_secs, 0);
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

    #[test]
    fn load_old_settings_without_language_uses_default() {
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        // Pre-i18n settings.json has no language field.
        let legacy = r#"{"themeId":"warm-minimal","density":"comfortable","systemFont":"system-default","systemFontSize":13,"filesFontSize":13,"terminal":{"fontFamily":"jetbrains-mono","fontSize":13,"cursorStyle":"block"},"schemaVersion":1}"#;
        std::fs::write(td.path().join("settings.json"), legacy).unwrap();
        let got = store.load().unwrap().unwrap();
        assert_eq!(got.language, "en");
    }

    #[test]
    fn load_old_settings_without_local_shell_uses_default() {
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        // Pre-local-pty settings.json has no localShell field.
        let legacy = r#"{"themeId":"warm-minimal","density":"comfortable","systemFont":"system-default","systemFontSize":13,"filesFontSize":13,"terminal":{"fontFamily":"jetbrains-mono","fontSize":13,"cursorStyle":"block"},"schemaVersion":1}"#;
        std::fs::write(td.path().join("settings.json"), legacy).unwrap();
        let got = store.load().unwrap().unwrap();
        assert_eq!(got.local_shell, None);
    }

    #[test]
    fn load_old_settings_without_auto_update_check_defaults_true() {
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        let legacy = r#"{"themeId":"warm-minimal","density":"comfortable","systemFont":"system-default","systemFontSize":13,"filesFontSize":13,"terminal":{"fontFamily":"jetbrains-mono","fontSize":13,"cursorStyle":"block"},"schemaVersion":1}"#;
        std::fs::write(td.path().join("settings.json"), legacy).unwrap();
        let got = store.load().unwrap().unwrap();
        assert!(got.auto_update_check);
    }
}

# Advanced Settings Panel — Design Spec

**Date:** 2026-08-13  
**Status:** Approved

## Goal

Activate the currently-greyed-out "Advanced" entry in the Settings sidebar and fill it with six categories of power-user parameters: SSH connection tuning, SFTP transfer concurrency, terminal scrollback depth, log level, and auto-reconnect policy. All settings are global (not per-host).

## Architecture

All new fields live in a single `advanced` sub-object on `Settings`, matching the existing `terminal` sub-object pattern. This keeps the root schema clean and lets future additions land without touching the parent struct.

The save path is unchanged: `advanced` serialises into `settings.json` alongside the other fields. A missing `advanced` key in an old file falls back to defaults via `#[serde(default)]`.

## Schema

### Rust — `src-tauri/src/settings/mod.rs`

```rust
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdvancedSettings {
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_secs: u32,       // 10, range 5–60
    #[serde(default = "default_keepalive_interval")]
    pub keepalive_interval_secs: u32,    // 60, 0 = disabled
    #[serde(default = "default_keepalive_max")]
    pub keepalive_max: u32,              // 3, range 1–10
    #[serde(default = "default_sftp_concurrency")]
    pub sftp_concurrency: u32,           // 4, range 1–16
    #[serde(default = "default_log_level")]
    pub log_level: String,               // "info" | "warn" | "error" | "debug"
    #[serde(default = "default_terminal_scrollback")]
    pub terminal_scrollback: u32,        // 5000, range 500–50000
    #[serde(default = "default_reconnect_interval")]
    pub reconnect_interval_secs: u32,    // 5, range 1–60
    #[serde(default = "default_reconnect_max_attempts")]
    pub reconnect_max_attempts: u32,     // 10, 0 = unlimited
}

fn default_connect_timeout() -> u32 { 10 }
fn default_keepalive_interval() -> u32 { 60 }
fn default_keepalive_max() -> u32 { 3 }
fn default_sftp_concurrency() -> u32 { 4 }
fn default_log_level() -> String { "info".into() }
fn default_terminal_scrollback() -> u32 { 5000 }
fn default_reconnect_interval() -> u32 { 5 }
fn default_reconnect_max_attempts() -> u32 { 10 }
```

`Settings` gets a new field:

```rust
#[serde(default)]
pub advanced: AdvancedSettings,
```

`impl Default for AdvancedSettings` must be derived or handwritten so the `serde(default)` attribute works.

### TypeScript — `src/types/settings.ts`

```typescript
export interface AdvancedSettings {
  connectTimeoutSecs: number;
  keepaliveIntervalSecs: number;
  keepaliveMax: number;
  sftpConcurrency: number;
  logLevel: "error" | "warn" | "info" | "debug";
  terminalScrollback: number;
  reconnectIntervalSecs: number;
  reconnectMaxAttempts: number;
}

export const DEFAULT_ADVANCED: AdvancedSettings = {
  connectTimeoutSecs: 10,
  keepaliveIntervalSecs: 60,
  keepaliveMax: 3,
  sftpConcurrency: 4,
  logLevel: "info",
  terminalScrollback: 5000,
  reconnectIntervalSecs: 5,
  reconnectMaxAttempts: 10,
};
```

`Settings` gets `advanced: AdvancedSettings` and `DEFAULT_SETTINGS.advanced = DEFAULT_ADVANCED`.

## Zustand store — `src/state/settings.ts`

Add one setter per field (pattern: `setAdvanced<Field>(v)`). Each setter uses `set(s => ({ advanced: { ...s.advanced, <field>: v } }))` followed by `scheduleSave(get)`. `snapshotForSave` must include `advanced`.

## UI — `src/components/settings/AdvancedPanel.tsx` (new)

Four sections, layout identical to `AppearancePanel`:

**SSH 连接**
- "连接超时" — slider 5–60 s, step 1, label shows value + "秒"
- "Keepalive 间隔" — slider 0–300 s, step 10; when value = 0 label shows "禁用"
- "Keepalive 最大次数" — slider 1–10, shown only when keepalive interval > 0

**文件传输**
- "SFTP 并发数" — slider 1–16, step 1

**终端**
- "滚动缓冲行数" — number input, min 500 max 50000, validated on blur

**重连**
- "断线重连间隔" — slider 1–60 s, step 1
- "最大重连次数" — slider 0–20; when value = 0 label shows "不限次数"

**调试**
- "日志级别" — segmented/select control: error / warn / info / debug; subtitle "修改后重启生效"

## SettingsSidebar — `src/components/settings/SettingsSidebar.tsx`

Remove the `dim` prop from the `advanced` Row and add `onClick={() => onSelect("advanced")}`. The entry is now always clickable.

## SettingsView — `src/components/settings/SettingsView.tsx`

Add `case "advanced": return <AdvancedPanel />;` to the section switch/conditional.

## Consumer wiring

### SSH timeout + keepalive — `src-tauri/src/protocol/ssh.rs`

`SshProtocol::connect()` gains an `advanced: &AdvancedSettings` parameter (imported from `crate::settings`).

```rust
// replace:
let config = Arc::new(client::Config::default());
// with:
let keepalive = if advanced.keepalive_interval_secs > 0 {
    Some(Duration::from_secs(advanced.keepalive_interval_secs as u64))
} else { None };
let config = Arc::new(client::Config {
    keepalive_interval: keepalive,
    keepalive_max: advanced.keepalive_max as usize,
    ..client::Config::default()
});
```

Replace the `CONNECT_TIMEOUT` constant usage with `Duration::from_secs(advanced.connect_timeout_secs as u64)`.

All callers of `SshProtocol::connect()` (in `session/manager.rs`) receive `&settings.advanced` threaded through from `State<'_, SettingsStore>`.

### SFTP concurrency — `src-tauri/src/transfer/mod.rs`

`TransferManager` gains `concurrency: Arc<Semaphore>` initialised to `settings.advanced.sftp_concurrency` at startup.

`start_upload` and `start_download` acquire a permit from the semaphore before spawning the byte-pump task. The permit is held for the lifetime of the transfer and released on completion/cancel/error.

`TransferManager` is re-initialised (or the semaphore cap updated) when `sftp_concurrency` changes in settings. The simplest approach is to store the current cap and rebuild the semaphore when the value changes — in-flight transfers complete against the old semaphore, new ones use the new cap.

### Terminal scrollback — `src/components/TerminalView.tsx`

Replace the hardcoded `scrollback: 5000` at line 70 with `scrollback: settings.advanced.terminalScrollback` (read from `useSettingsStore`). The terminal is already re-mounted on meaningful prop changes; a change in scrollback takes effect on next terminal open.

### Log level — `src-tauri/src/main.rs`

Read `settings.advanced.log_level` from `SettingsStore` at startup (before the Tauri builder runs) and map to `log::LevelFilter`:

```rust
let level = match advanced.log_level.as_str() {
    "error" => LevelFilter::Error,
    "warn"  => LevelFilter::Warn,
    "debug" => LevelFilter::Debug,
    _       => LevelFilter::Info,
};
tauri_plugin_log::Builder::default().level(level)
```

This is static — the level is baked in at launch. The UI shows a subtitle explaining a restart is needed.

### Auto-reconnect — `src/App.tsx`

When a session's status transitions to `"closed"` unexpectedly (i.e., not triggered by the user clicking disconnect), start a reconnect loop:

1. Check `settings.advanced.reconnectMaxAttempts`: if 0, attempt indefinitely; otherwise track attempt count.
2. After `settings.advanced.reconnectIntervalSecs` seconds, invoke the existing connect flow for that host.
3. On success: clear the attempt counter, session resumes normally.
4. On failure: increment counter; if at max, stop and leave the session in "closed" state so the user sees the normal error UI.
5. A user-initiated disconnect sets a flag that suppresses the reconnect loop for that session.

The reconnect state is per-session and ephemeral (not persisted). Track it with a `useRef` map: `reconnectTimers: Map<sessionId, timeoutHandle>`.

## File change summary

| File | Change |
|------|--------|
| `src/types/settings.ts` | Add `AdvancedSettings` interface + `DEFAULT_ADVANCED` + `advanced` field on `Settings` |
| `src/state/settings.ts` | Add setters, include `advanced` in `snapshotForSave` |
| `src/components/settings/AdvancedPanel.tsx` | New component |
| `src/components/settings/SettingsSidebar.tsx` | Remove `dim` from Advanced row |
| `src/components/settings/SettingsView.tsx` | Route `"advanced"` section to `AdvancedPanel` |
| `src/components/TerminalView.tsx` | Read `terminalScrollback` from settings |
| `src/App.tsx` | Auto-reconnect loop |
| `src-tauri/src/settings/mod.rs` | Add `AdvancedSettings` struct + `advanced` field on `Settings` + defaults + tests |
| `src-tauri/src/protocol/ssh.rs` | Accept `AdvancedSettings` in `connect()`, set keepalive + timeout |
| `src-tauri/src/session/manager.rs` | Thread `AdvancedSettings` to `connect()` calls |
| `src-tauri/src/transfer/mod.rs` | Add `Semaphore` to `TransferManager`, wire concurrency cap |
| `src-tauri/src/main.rs` | Set log level from `advanced.log_level` at startup |

## Global constraints

- All new settings fields use `#[serde(default)]` — no migration script needed, old settings.json loads cleanly.
- No per-host overrides — all settings are global.
- Reconnect loop suppressed for user-initiated disconnects.
- Log level change requires app restart; UI must say so.
- SFTP concurrency change takes effect for new transfers only; in-flight transfers complete under the old cap.
- `schemaVersion` stays at 1 — no schema bump needed since serde defaults handle the new fields.

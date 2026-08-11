# Local PTY Terminal — Design Spec

**Date:** 2026-08-11  
**Feature:** Local terminal tab (spawn a local shell process inside shellx)

---

## Goal

Allow users to open a local terminal tab inside shellx — a PTY-backed process running the system shell (or a user-configured executable) — displayed and operated the same way as an SSH shell tab.

---

## Design Decisions (locked)

| Decision | Choice |
|---|---|
| Shell executable | User-configurable in Settings; defaults to system shell |
| UI | Regular tab, identical to SSH — no rail, no modal |
| Multiple instances | Yes — each "Local Terminal" click/menu item opens a new tab |
| Status dot color | Purple (`#8B5CF6`) — distinct from SSH green (`var(--success)`) |
| Process exit | Auto-close tab (same behavior as SSH disconnect) |

---

## Architecture

### Principle

Reuse the existing session data flow entirely. SSH shell tabs today work via three events:
- `session:data` — terminal output chunks
- `session:input` — keystrokes from the frontend
- `connection:closed` — session ended

Local PTY taps into the same pipeline. The frontend terminal component (`XTermPanel`) is unaware of whether the backend is SSH or a local process.

### Backend (`src-tauri/src/`)

**New files:**
- `protocol/local.rs` — `LocalHandle`: wraps a PTY-backed child process
- `ipc/local.rs` — `open_local` and `close_local` Tauri commands

**Modified files:**
- `session.rs` / `session_manager.rs` — add `local_sessions: HashMap<Uuid, LocalHandle>` alongside existing SSH sessions; wire `session:data` and `connection:closed` emission
- `ipc/mod.rs` — register `open_local`, `close_local`
- `store/settings.rs` — add `local_shell: Option<String>` field
- `ipc/settings.rs` — expose `get_settings` / `set_settings` (or extend existing)
- `lib.rs` — register new commands

**PTY crate:** `portable-pty` (crate `portable-pty`, part of the WezTerm project). Handles ConPTY on Windows and Unix PTY on macOS/Linux.

```toml
# Cargo.toml addition
portable-pty = "0.8"
```

**`LocalHandle` interface:**
```rust
pub struct LocalHandle {
    pub session_id: Uuid,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn Child + Send + Sync>,
    _pty: Box<dyn MasterPty + Send>,
}

impl LocalHandle {
    pub fn spawn(session_id: Uuid, shell: &str, app: AppHandle) -> Result<Self>;
    pub fn write(&mut self, data: &[u8]) -> Result<()>;
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()>;
}
```

**`open_local` command:**
```rust
#[tauri::command]
pub async fn open_local(app: AppHandle, state: State<'_, AppState>) -> Result<Uuid>
```
- Reads `local_shell` from settings (falls back to `$SHELL` / `cmd.exe` by platform)
- Spawns `LocalHandle::spawn(...)`
- Stores in `session_manager.local_sessions`
- Returns `session_id` (Uuid)
- Starts a reader task that emits `session:data` events on stdout
- On process exit, emits `connection:closed` and removes from map

**`close_local` command:**
```rust
#[tauri::command]
pub async fn close_local(app: AppHandle, state: State<'_, AppState>, session_id: Uuid) -> Result<()>
```
- Kills the child process
- Removes from map (the reader task will also clean up via exit)

**Settings field:**
```rust
pub struct AppSettings {
    // existing fields ...
    pub local_shell: Option<String>,  // None → use platform default
}
```

### Frontend (`src/`)

**New file:**
- `src/ipc/local.ts` — `openLocal(): Promise<string>`, `closeLocal(sessionId: string): Promise<void>`

**Modified files:**
- `src/types.ts` — add `"local"` to `SessionKind`
- `src/components/TabBar.tsx` — local tab dot: purple (`#8B5CF6`)
- `src/components/AddTabMenu.tsx` (or wherever `+` menu lives) — enable "Local Terminal" entry, call `openLocal()`
- `src/App.tsx` — handle `openLocal()` result, create tab of kind `"local"`; handle tab close → `closeLocal()`
- `src/pages/Settings.tsx` (or equivalent) — add "Local shell" text input, bound to `local_shell` setting

**Tab dot logic (TabBar.tsx):**
```tsx
const dotColor =
  t.state === "closed"    ? "var(--text-3)"
  : t.kind === "local"    ? "#8B5CF6"
  : "var(--success)";
```

**Settings UI:**
- Section: "Terminal"
- Field label: "Local shell"
- Input: text field, placeholder `"Default (system shell)"`
- Help text: "Leave blank to use the system default (PowerShell on Windows, $SHELL on macOS/Linux)"

### Shell defaults by platform

| Platform | Default when `local_shell` is `None` |
|---|---|
| Windows | `cmd.exe` (or `powershell.exe` — see note) |
| macOS | `$SHELL` env var, fallback `/bin/zsh` |
| Linux | `$SHELL` env var, fallback `/bin/bash` |

> Windows default: use `cmd.exe` first (universal, no extra install). PowerShell would be a better UX but `cmd.exe` is guaranteed present. The user can override in Settings.

---

## Event Flow

```
User clicks "Local Terminal"
  → frontend calls openLocal() IPC
  → Rust: spawn PTY process, store LocalHandle
  → Rust returns session_id
  → frontend: createTab({ id: session_id, kind: "local", title: "Local Terminal" })
  → XTermPanel mounts, subscribes to session:data for this session_id

User types
  → XTermPanel emits session:input
  → Rust: write bytes to PTY master

Process prints output
  → Rust reader task: emit session:data
  → XTermPanel renders

User types `exit` / process crashes
  → child process exits
  → Rust reader task: detects EOF, emits connection:closed
  → frontend: removeTab(session_id)   ← auto-close
```

---

## Out of Scope

- Serial / USB-CDC sessions (separate feature branch)
- Terminal multiplexer / split panes
- Persistent sessions (tmux-style reconnect)
- Shell history syncing across tabs

---

## Testing

**Rust unit tests:**
- `LocalHandle::spawn` with a trivial command (`echo hello`) — verify `session:data` event fires with correct bytes
- Settings serialization roundtrip for `local_shell`

**Manual smoke test:**
1. Open shellx, click `+` → "Local Terminal"
2. Verify purple dot, tab title "Local Terminal"
3. Type a command (e.g., `echo hi`), verify output
4. Type `exit`, verify tab auto-closes
5. Open two local terminal tabs simultaneously — verify independence
6. Settings → set custom shell path, reopen local terminal — verify new shell used

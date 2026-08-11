# Local PTY Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Local Terminal" tab to shellx that spawns the system shell as a PTY process, reusing the existing session:data / connection:closed event pipeline that SSH already uses.

**Architecture:** A new `SessionManager.local_sessions` map runs a per-process driver loop identical in structure to `shell_driver_loop`, pushing stdout bytes into the shared `subs` map so the frontend's `XTermPanel` works unchanged. `write_session_input`, `resize_session`, and `close_connection` are extended to check both SSH and local maps. The `ConnectionKind` enum gains a `Local` variant so the frontend can distinguish tab dot colour.

**Tech Stack:** Rust `portable-pty 0.8` (cross-platform ConPTY/forkpty); existing Tauri IPC event pipeline; React/TypeScript frontend with Zustand stores.

## Global Constraints

- Branch: `feat/local-pty` — never commit to `main` directly
- Crate `portable-pty = "0.8"` — use exactly this dependency line in Cargo.toml
- IPC module naming: new backend file is `src-tauri/src/ipc/local_pty.rs` (not to be confused with `ipc/local.rs` which is filesystem ops)
- Tauri command names: `open_local_terminal`, `close_local_terminal` (snake_case, matches existing conventions)
- Local tab dot colour: `#8B5CF6` (purple) — distinct from SSH green (`var(--success)`)
- `Settings.local_shell` persisted as `localShell` in JSON (`#[serde(rename_all = "camelCase")]` is already active)
- `ConnectionKind::Local` serialises as `"local"` (follow existing `#[serde(rename_all = "lowercase")]`)
- All commits on the feature branch; no Co-Authored-By lines

---

## File Map

**New files:**
- `src-tauri/src/protocol/local_pty.rs` — `LocalPtyHandle`, `spawn_local_pty`, `local_driver_loop`
- `src-tauri/src/ipc/local_pty.rs` — `open_local_terminal`, `close_local_terminal` IPC commands
- `src/ipc/local_pty.ts` — frontend IPC wrappers

**Modified files:**
- `src-tauri/Cargo.toml` — add `portable-pty = "0.8"` dependency
- `src-tauri/src/session/mod.rs` — add `ConnectionKind::Local`
- `src-tauri/src/session/manager.rs` — `local_sessions` map + extend write/resize/close/list
- `src-tauri/src/protocol/mod.rs` — `pub mod local_pty;`
- `src-tauri/src/ipc/mod.rs` — `pub mod local_pty;`
- `src-tauri/src/main.rs` — register two new commands
- `src-tauri/src/settings/mod.rs` — add `local_shell: Option<String>` field to `Settings`
- `src/types/connection.ts` — add `"local"` to `ConnectionInfo.kind` union
- `src/types/session.ts` — add `"local"` to `SessionKind`
- `src/types/settings.ts` — add `localShell?: string` to `Settings` + `DEFAULT_SETTINGS`
- `src/state/settings.ts` — add `localShell` field, `setLocalShell` action, include in `snapshotForSave`
- `src/components/TabBar.tsx` — `Tab.kind`, kind-aware dot colour, enable "New local terminal" menu item
- `src/App.tsx` — wire `openLocalTerminal`, pass `kind` into `Tab` objects

---

### Task 1: Create feature branch + add `portable-pty` crate

**Files:**
- Modify: `src-tauri/Cargo.toml` (line 48 area, after `uuid`)

**Interfaces:**
- Produces: `portable_pty` crate available to Tasks 2–4

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat/local-pty
```

- [ ] **Step 2: Add `portable-pty` to Cargo.toml**

Open `src-tauri/Cargo.toml`. In the `[dependencies]` section, add after the `uuid` line:

```toml
portable-pty = "0.8"
```

- [ ] **Step 3: Verify the crate resolves**

```bash
cd src-tauri && cargo check 2>&1 | head -30
```

Expected: no errors about unresolved `portable-pty`. Warnings are fine.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(deps): add portable-pty 0.8 for local PTY terminal"
```

---

### Task 2: `ConnectionKind::Local` in `session/mod.rs`

**Files:**
- Modify: `src-tauri/src/session/mod.rs` (lines 17–21)

**Interfaces:**
- Produces: `ConnectionKind::Local` serialises as `"local"` for frontend

- [ ] **Step 1: Add `Local` variant to `ConnectionKind`**

The current enum at `src-tauri/src/session/mod.rs:17`:
```rust
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionKind {
    Ssh,
}
```

Replace with:
```rust
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionKind {
    Ssh,
    Local,
}
```

- [ ] **Step 2: Verify compile**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/session/mod.rs
git commit -m "feat(session): add ConnectionKind::Local for local PTY sessions"
```

---

### Task 3: `LocalPtyHandle` + driver loop in `src-tauri/src/protocol/local_pty.rs`

**Files:**
- Create: `src-tauri/src/protocol/local_pty.rs`
- Modify: `src-tauri/src/protocol/mod.rs` (add `pub mod local_pty;`)

**Interfaces:**
- Consumes: `portable_pty` crate; `subs: Arc<Mutex<HashMap<Uuid, mpsc::Sender<Vec<u8>>>>>` from SessionManager; `inner_local: Arc<Mutex<HashMap<Uuid, LocalPtyHandle>>>` from SessionManager
- Produces:
  - `pub struct LocalPtyHandle { pub info: ConnectionInfo, writer: mpsc::Sender<LocalCmd> }`
  - `pub async fn spawn_local_pty(shell: &str, session_id: Uuid, label: String, app: AppHandle, subs: Arc<...>, inner_local: Arc<...>) -> crate::error::Result<LocalPtyHandle>`

- [ ] **Step 1: Write the test first**

Add a test at the bottom of the new `local_pty.rs`. The test will verify that spawning a trivial command and writing to it produces output through the subscriber. We'll use a tokio test:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::{ConnectionKind, ConnectionState};
    use std::collections::HashMap;
    use tauri::test::{mock_builder, MockRuntime};
    use tokio::sync::Mutex;
    use uuid::Uuid;

    #[tokio::test]
    async fn spawn_echo_produces_data() {
        // Use `echo` on Unix, `cmd /c echo` on Windows — we just need
        // something that prints and exits, so we can verify the subscriber
        // receives data and the channel closes.
        let session_id = Uuid::new_v4();
        let subs: Arc<Mutex<HashMap<Uuid, mpsc::Sender<Vec<u8>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let inner_local: Arc<Mutex<HashMap<Uuid, LocalPtyHandle>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // Use a shell command that exits quickly.
        #[cfg(windows)]
        let shell = "cmd";
        #[cfg(not(windows))]
        let shell = "sh";

        // We can't easily wire a full AppHandle in a unit test without
        // a running Tauri app. Instead, verify the driver spawns without
        // panicking and that we get a writer channel back.
        // Full integration tested via manual smoke test (see spec).
    }
}
```

> Note: the portable-pty driver loop emits Tauri events, which require a real AppHandle. The unit test above only verifies compilation and channel setup. Full behavior is verified by the smoke test in Task 9.

- [ ] **Step 2: Write `local_pty.rs`**

Create `src-tauri/src/protocol/local_pty.rs`:

```rust
use crate::error::{Error, Result};
use crate::session::{ConnectionId, ConnectionInfo, ConnectionKind, ConnectionState};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::ipc::events::{ClosedEvent, DataEvent, EV_CLOSED, EV_DATA};

pub struct LocalPtyHandle {
    pub info: ConnectionInfo,
    writer: mpsc::Sender<LocalCmd>,
}

enum LocalCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

impl LocalPtyHandle {
    pub async fn write(&self, data: &[u8]) -> Result<()> {
        self.writer
            .send(LocalCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed)
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.writer
            .send(LocalCmd::Resize(cols, rows))
            .await
            .map_err(|_| Error::Closed)
    }

    pub async fn close(&self) {
        let _ = self.writer.send(LocalCmd::Close).await;
    }
}

/// Spawns a local PTY process running `shell` and returns a `LocalPtyHandle`
/// whose lifetime is tied to the background driver task.
///
/// The driver task:
/// - reads stdout/stderr from the PTY master (blocking, in spawn_blocking)
/// - pushes chunks to `subs[session_id]`
/// - on process exit or `LocalCmd::Close`, emits `connection:closed` and
///   removes the session from both `subs` and `inner_local`
pub async fn spawn_local_pty(
    shell: &str,
    session_id: Uuid,
    label: String,
    app: AppHandle,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    inner_local: Arc<Mutex<HashMap<Uuid, LocalPtyHandle>>>,
) -> Result<LocalPtyHandle> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| Error::Protocol(format!("openpty: {e}")))?;

    let mut cmd = CommandBuilder::new(shell);
    // Inherit the current working directory and environment.

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| Error::Protocol(format!("spawn {shell}: {e}")))?;
    // Drop the slave end — on some platforms (notably macOS) keeping it
    // open prevents the reader from ever seeing EOF when the child exits.
    drop(pair.slave);

    // master.try_clone_reader() returns a blocking Read — run it in
    // spawn_blocking so we don't block the Tokio runtime.
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| Error::Protocol(format!("clone_reader: {e}")))?;

    let master = Arc::new(
        pair.master
    );

    let (writer_tx, writer_rx) = mpsc::channel::<LocalCmd>(64);

    let info = ConnectionInfo {
        id: session_id,
        label,
        kind: ConnectionKind::Local,
        host_id: None,
        state: ConnectionState::Active,
    };

    // Spawn the driver task.
    let subs_driver = subs.clone();
    let inner_driver = inner_local.clone();
    let app_driver = app.clone();
    let master_driver = master.clone();
    tokio::spawn(local_driver_loop(
        session_id,
        reader,
        master_driver,
        _child,
        writer_rx,
        subs_driver,
        inner_driver,
        app_driver,
    ));

    Ok(LocalPtyHandle {
        info,
        writer: writer_tx,
    })
}

async fn local_driver_loop(
    id: Uuid,
    reader: Box<dyn std::io::Read + Send>,
    master: Arc<Box<dyn portable_pty::MasterPty + Send>>,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    mut cmds: mpsc::Receiver<LocalCmd>,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    inner_local: Arc<Mutex<HashMap<Uuid, LocalPtyHandle>>>,
    app: AppHandle,
) {
    // Read loop: blocking I/O in spawn_blocking, posts chunks via a oneshot
    // so we can select! with the command channel.
    let (read_tx, mut read_rx) = mpsc::channel::<Vec<u8>>(64);
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if read_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    loop {
        tokio::select! {
            cmd = cmds.recv() => match cmd {
                Some(LocalCmd::Bytes(b)) => {
                    // Write to PTY master from a blocking context.
                    let master2 = master.clone();
                    tokio::task::spawn_blocking(move || {
                        if let Ok(mut w) = master2.take_writer() {
                            let _ = std::io::Write::write_all(&mut w, &b);
                        }
                    });
                }
                Some(LocalCmd::Resize(cols, rows)) => {
                    let _ = master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                }
                Some(LocalCmd::Close) | None => {
                    let _ = child.kill();
                    break;
                }
            },
            chunk = read_rx.recv() => match chunk {
                Some(bytes) => {
                    let tx = subs.lock().await.get(&id).cloned();
                    if let Some(tx) = tx {
                        let _ = tx.send(bytes).await;
                    }
                }
                None => break,  // reader exited (child exited)
            },
        }
    }

    // Clean up: remove from both maps, emit connection:closed.
    subs.lock().await.remove(&id);
    inner_local.lock().await.remove(&id);
    let _ = app.emit(EV_CLOSED, ClosedEvent { id, reason: "eof".into() });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_pty_handle_is_send() {
        fn assert_send<T: Send>() {}
        // Compile-time check that LocalPtyHandle can cross thread boundaries.
        // portable-pty's MasterPty is Send; mpsc::Sender<LocalCmd> is Send.
        assert_send::<LocalPtyHandle>();
    }
}
```

> **Note on `master.take_writer()`**: `take_writer()` consumes the writer — call it once in the driver loop, storing it in a `Mutex<Option<Box<dyn Write+Send>>>`. The code above sketches the intent; the implementer should adjust based on the exact `portable-pty 0.8` API (the writer is obtained once and kept in the driver task's locals, not cloned per-write). See the corrected version below in Step 3.

- [ ] **Step 3: Correct the writer pattern**

The driver loop above calls `take_writer()` per write which won't work after the first call. Replace the driver loop's command handling section with a single-writer approach:

```rust
async fn local_driver_loop(
    id: Uuid,
    reader: Box<dyn std::io::Read + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    mut cmds: mpsc::Receiver<LocalCmd>,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    inner_local: Arc<Mutex<HashMap<Uuid, LocalPtyHandle>>>,
    app: AppHandle,
) {
    // Obtain writer once.
    let mut pty_writer = match master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            log::error!("local_pty: take_writer failed: {e}");
            return;
        }
    };
    let master = Arc::new(master);

    let (read_tx, mut read_rx) = mpsc::channel::<Vec<u8>>(64);
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if read_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Write channel: another spawn_blocking owns the writer.
    let (wtx, mut wrx) = mpsc::channel::<Vec<u8>>(64);
    tokio::task::spawn_blocking(move || {
        while let Some(bytes) = wrx.blocking_recv() {
            if std::io::Write::write_all(&mut pty_writer, &bytes).is_err() {
                break;
            }
        }
    });

    loop {
        tokio::select! {
            cmd = cmds.recv() => match cmd {
                Some(LocalCmd::Bytes(b)) => {
                    let _ = wtx.send(b).await;
                }
                Some(LocalCmd::Resize(cols, rows)) => {
                    let _ = master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                }
                Some(LocalCmd::Close) | None => {
                    let _ = child.kill();
                    break;
                }
            },
            chunk = read_rx.recv() => match chunk {
                Some(bytes) => {
                    let tx = subs.lock().await.get(&id).cloned();
                    if let Some(tx) = tx {
                        let _ = tx.send(bytes).await;
                    }
                }
                None => break,
            },
        }
    }

    subs.lock().await.remove(&id);
    inner_local.lock().await.remove(&id);
    let _ = app.emit(EV_CLOSED, ClosedEvent { id, reason: "eof".into() });
}
```

The complete `local_pty.rs` uses the Step 3 version of `local_driver_loop` (discard Step 2's version).

- [ ] **Step 4: Declare the module in `protocol/mod.rs`**

Add `pub mod local_pty;` after `pub mod ssh;` in `src-tauri/src/protocol/mod.rs` (line 6):

```rust
pub mod sftp_types;
pub mod ssh;
pub mod local_pty;
```

- [ ] **Step 5: Verify compile**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/protocol/local_pty.rs src-tauri/src/protocol/mod.rs
git commit -m "feat(protocol): add LocalPtyHandle and local PTY driver loop"
```

---

### Task 4: `settings/mod.rs` — `local_shell` field

**Files:**
- Modify: `src-tauri/src/settings/mod.rs` (lines 1–36)

**Interfaces:**
- Produces: `Settings.local_shell: Option<String>` serialised as `"localShell"` in JSON

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/settings/mod.rs`, add to the `tests` module:

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test settings::tests::load_old_settings_without_local_shell_uses_default 2>&1 | tail -10
```

Expected: compile error — `no field local_shell on Settings`.

- [ ] **Step 3: Add `local_shell` to `Settings` struct**

In `src-tauri/src/settings/mod.rs`, find the `Settings` struct. Add the field at the end, before `schema_version`:

```rust
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme_id: String,
    pub density: String,
    #[serde(default = "default_system_font")]
    pub system_font: String,
    #[serde(default = "default_system_font_size")]
    pub system_font_size: u32,
    #[serde(default = "default_files_font_size")]
    pub files_font_size: u32,
    pub terminal: TerminalSettings,
    /// Path or command for the local terminal shell.
    /// None → use platform default (cmd.exe on Windows, $SHELL on Unix).
    #[serde(default)]
    pub local_shell: Option<String>,
    pub schema_version: u32,
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd src-tauri && cargo test settings 2>&1 | tail -15
```

Expected: all settings tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings/mod.rs
git commit -m "feat(settings): add local_shell field for configurable terminal shell"
```

---

### Task 5: Extend `SessionManager` with local session support

**Files:**
- Modify: `src-tauri/src/session/manager.rs`

**Interfaces:**
- Consumes: `LocalPtyHandle` from Task 3; `ConnectionKind::Local` from Task 2; `Settings.local_shell` from Task 4
- Produces:
  - `SessionManager.open_local_session(shell: &str, app: AppHandle) -> Result<ConnectionInfo>`
  - `SessionManager.write(id, data)` now also delegates to local sessions
  - `SessionManager.resize(id, cols, rows)` now also delegates to local sessions
  - `SessionManager.close(id)` now also closes local sessions
  - `SessionManager.list()` now includes local sessions

- [ ] **Step 1: Write the failing test**

Add to the `tests` module at the bottom of `manager.rs`. This test does NOT need a real shell — it just verifies that `list()` returns local sessions and `close()` removes them:

```rust
#[tokio::test]
async fn local_session_appears_in_list_and_closes() {
    // We can't spawn a real PTY in unit tests without a Tauri AppHandle,
    // so insert a fake LocalPtyHandle directly.
    use crate::protocol::local_pty::LocalPtyHandle;
    use crate::session::{ConnectionKind, ConnectionState};
    use tokio::sync::mpsc;

    let mgr = SessionManager::new();
    let id = uuid::Uuid::new_v4();
    let fake_info = crate::session::ConnectionInfo {
        id,
        label: "local-test".into(),
        kind: ConnectionKind::Local,
        host_id: None,
        state: ConnectionState::Active,
    };
    let handle = LocalPtyHandle::new_for_test(fake_info.clone());
    mgr.local_sessions.lock().await.insert(id, handle);

    let list = mgr.list().await;
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, id);
    assert!(matches!(list[0].kind, ConnectionKind::Local));

    mgr.close(id).await.unwrap();
    assert!(mgr.list().await.is_empty());
}
```

We'll also add a `LocalPtyHandle::new_for_test` constructor (test-only, cfg(test)) in `local_pty.rs`. It creates a dummy sender internally so `LocalCmd` stays private:

```rust
#[cfg(test)]
impl LocalPtyHandle {
    pub fn new_for_test(info: ConnectionInfo) -> Self {
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        Self { info, writer: tx }
    }
}
```

- [ ] **Step 2: Add `local_sessions` to `SessionManager`**

In `src-tauri/src/session/manager.rs`, add the import and field:

After the existing imports, add:
```rust
use crate::protocol::local_pty::LocalPtyHandle;
```

In the `SessionManager` struct:
```rust
pub struct SessionManager {
    inner: Arc<Mutex<HashMap<ConnectionId, Arc<Mutex<LiveConnection>>>>>,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    pub(crate) local_sessions: Arc<Mutex<HashMap<Uuid, LocalPtyHandle>>>,
}
```

In `SessionManager::new()`:
```rust
pub fn new() -> Self {
    Self {
        inner: Arc::new(Mutex::new(HashMap::new())),
        subs: Arc::new(Mutex::new(HashMap::new())),
        local_sessions: Arc::new(Mutex::new(HashMap::new())),
    }
}
```

- [ ] **Step 3: Add `open_local_session`**

Add after `open_connection`:
```rust
pub async fn open_local_session(
    &self,
    shell: &str,
    label: String,
    app: AppHandle,
) -> Result<ConnectionInfo> {
    let session_id = Uuid::new_v4();
    let handle = crate::protocol::local_pty::spawn_local_pty(
        shell,
        session_id,
        label.clone(),
        app.clone(),
        self.subs.clone(),
        self.local_sessions.clone(),
    )
    .await?;
    let info = handle.info.clone();
    self.local_sessions.lock().await.insert(session_id, handle);
    // Attach subscriber channel so the IPC layer can wire event emission.
    let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
    self.subs.lock().await.insert(session_id, tx);
    Ok(info)
}
```

Wait — the `spawn_local_pty` function already registers the session in `inner_local` AND the driver loop removes it on exit, emitting `connection:closed`. BUT we also need the IPC layer to subscribe and emit `session:data` events. Let's move the subscribe wiring into `open_local_session`, consistent with how `open_connection` calls `mgr.subscribe(id)` and spawns a forwarder task in `ipc/mod.rs`.

So `open_local_session` does NOT do the subscribe — that's the IPC layer's job (Task 6). `open_local_session` just spawns the process and stores the handle.

Corrected version (no subscribe in here):
```rust
pub async fn open_local_session(
    &self,
    shell: &str,
    label: String,
    app: AppHandle,
) -> Result<ConnectionInfo> {
    let session_id = Uuid::new_v4();
    let handle = crate::protocol::local_pty::spawn_local_pty(
        shell,
        session_id,
        label,
        app,
        self.subs.clone(),
        self.local_sessions.clone(),
    )
    .await?;
    let info = handle.info.clone();
    self.local_sessions.lock().await.insert(session_id, handle);
    Ok(info)
}
```

- [ ] **Step 4: Extend `write()` to delegate to local sessions**

Current `write` signature: `pub async fn write(&self, id: ConnectionId, data: &[u8]) -> Result<()>`

Replace the body:
```rust
pub async fn write(&self, id: ConnectionId, data: &[u8]) -> Result<()> {
    // Try SSH first.
    if self.inner.lock().await.contains_key(&id) {
        let writer = self.shell_writer(id).await?;
        return writer
            .send(ShellCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed);
    }
    // Fall back to local PTY.
    let local = self.local_sessions.lock().await;
    let handle = local.get(&id).ok_or(Error::Closed)?;
    handle.write(data).await
}
```

But `handle.write` takes `&[u8]` and is `async` — `LocalPtyHandle::write` already has that signature from Task 3. However, we're holding the lock while awaiting `handle.write`. Since `handle.write` just sends to a mpsc channel (no I/O), it's very fast, but we should be careful. Better to clone the sender:

```rust
pub async fn write(&self, id: ConnectionId, data: &[u8]) -> Result<()> {
    if self.inner.lock().await.contains_key(&id) {
        let writer = self.shell_writer(id).await?;
        return writer
            .send(ShellCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed);
    }
    let writer = {
        let local = self.local_sessions.lock().await;
        let handle = local.get(&id).ok_or(Error::Closed)?;
        handle.writer_clone()
    };
    writer.send_bytes(data).await
}
```

Add to `LocalPtyHandle` in `local_pty.rs`:
```rust
pub fn writer_clone(&self) -> LocalPtyWriter {
    LocalPtyWriter(self.writer.clone())
}

pub struct LocalPtyWriter(mpsc::Sender<LocalCmd>);

impl LocalPtyWriter {
    pub async fn send_bytes(&self, data: &[u8]) -> Result<()> {
        self.0
            .send(LocalCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed)
    }
    pub async fn send_resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.0
            .send(LocalCmd::Resize(cols, rows))
            .await
            .map_err(|_| Error::Closed)
    }
    pub async fn send_close(&self) {
        let _ = self.0.send(LocalCmd::Close).await;
    }
}
```

Then `write()` in `manager.rs` becomes:
```rust
pub async fn write(&self, id: ConnectionId, data: &[u8]) -> Result<()> {
    if self.inner.lock().await.contains_key(&id) {
        let writer = self.shell_writer(id).await?;
        return writer
            .send(ShellCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed);
    }
    let writer = {
        let local = self.local_sessions.lock().await;
        local.get(&id).ok_or(Error::Closed)?.writer_clone()
    };
    writer.send_bytes(data).await
}
```

- [ ] **Step 5: Extend `resize()`**

Replace body of `resize`:
```rust
pub async fn resize(&self, id: ConnectionId, cols: u16, rows: u16) -> Result<()> {
    if self.inner.lock().await.contains_key(&id) {
        let writer = self.shell_writer(id).await?;
        return writer
            .send(ShellCmd::Resize(cols, rows))
            .await
            .map_err(|_| Error::Closed);
    }
    let writer = {
        let local = self.local_sessions.lock().await;
        local.get(&id).ok_or(Error::Closed)?.writer_clone()
    };
    writer.send_resize(cols, rows).await
}
```

- [ ] **Step 6: Extend `close()`**

The current `close` only looks in `inner`. Extend it:
```rust
pub async fn close(&self, id: ConnectionId) -> Result<()> {
    // SSH path.
    if self.inner.lock().await.contains_key(&id) {
        self.close_all_tunnels(id).await;
        let removed = self.inner.lock().await.remove(&id);
        if let Some(live_arc) = removed {
            let mut live = live_arc.lock().await;
            if let Some(shell) = live.shell.take() {
                let _ = shell.writer.send(ShellCmd::Close).await;
            }
            let _ = live.conn.disconnect().await;
        }
        self.subs.lock().await.remove(&id);
        return Ok(());
    }
    // Local PTY path.
    let writer = {
        let local = self.local_sessions.lock().await;
        local.get(&id).map(|h| h.writer_clone())
    };
    if let Some(w) = writer {
        w.send_close().await;
        // The driver loop removes the handle from `local_sessions` on its
        // own exit path — we don't remove it here to avoid a race.
    }
    self.subs.lock().await.remove(&id);
    Ok(())
}
```

- [ ] **Step 7: Extend `list()` to include local sessions**

```rust
pub async fn list(&self) -> Vec<ConnectionInfo> {
    let ssh_arcs: Vec<_> = self.inner.lock().await.values().cloned().collect();
    let mut result = Vec::new();
    for a in ssh_arcs {
        result.push(a.lock().await.info.clone());
    }
    for handle in self.local_sessions.lock().await.values() {
        result.push(handle.info.clone());
    }
    result
}
```

- [ ] **Step 8: Run unit tests**

```bash
cd src-tauri && cargo test session 2>&1 | tail -20
```

Expected: all session manager tests PASS including the new `local_session_appears_in_list_and_closes`.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/session/manager.rs src-tauri/src/protocol/local_pty.rs
git commit -m "feat(session): extend SessionManager with local PTY session support"
```

---

### Task 6: `ipc/local_pty.rs` — IPC commands + registration

**Files:**
- Create: `src-tauri/src/ipc/local_pty.rs`
- Modify: `src-tauri/src/ipc/mod.rs` (add `pub mod local_pty;`)
- Modify: `src-tauri/src/main.rs` (register two new commands)

**Interfaces:**
- Consumes: `SessionManager::open_local_session`, `SessionManager::close`, `SessionManager::subscribe`, `SettingsStore::load`, IPC event helpers
- Produces:
  - Tauri command `open_local_terminal` → returns `ConnectionInfo`
  - Tauri command `close_local_terminal` → returns `()`
  - Emits `session:data` and `connection:closed` events (same as SSH)

- [ ] **Step 1: Write `src-tauri/src/ipc/local_pty.rs`**

```rust
//! IPC commands for opening and closing local PTY terminal sessions.

use crate::error::Result;
use crate::session::manager::SessionManager;
use crate::session::{ConnectionInfo, SessionId};
use crate::settings::SettingsStore;
use events::{ClosedEvent, DataEvent, EV_CLOSED, EV_DATA};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use super::events;

/// Default shell per platform when `settings.local_shell` is None or empty.
fn default_shell() -> String {
    #[cfg(windows)]
    return "cmd.exe".into();
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

#[tauri::command]
pub async fn open_local_terminal(
    app: AppHandle,
    mgr: State<'_, SessionManager>,
    settings: State<'_, SettingsStore>,
) -> Result<ConnectionInfo> {
    let shell = settings
        .load()
        .ok()
        .flatten()
        .and_then(|s| s.local_shell.filter(|s| !s.is_empty()))
        .unwrap_or_else(default_shell);

    let info = mgr
        .open_local_session(&shell, "Local Terminal".into(), app.clone())
        .await?;

    let id = info.id;
    let mut rx = mgr.subscribe(id).await?;
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = app_clone.emit(EV_DATA, DataEvent { id, data: chunk });
        }
        let _ = app_clone.emit(EV_CLOSED, ClosedEvent { id, reason: "eof".into() });
    });

    Ok(info)
}

#[derive(Deserialize)]
pub struct CloseLocalArgs {
    pub id: SessionId,
}

#[tauri::command]
pub async fn close_local_terminal(
    args: CloseLocalArgs,
    mgr: State<'_, SessionManager>,
) -> Result<()> {
    mgr.close(args.id).await
}
```

- [ ] **Step 2: Declare the module in `ipc/mod.rs`**

Add `pub mod local_pty;` at the top of `src-tauri/src/ipc/mod.rs`, after the existing `pub mod tunnels;` line:

```rust
pub mod config;
pub mod events;
pub mod hostkeys;
pub mod hosts;
pub mod keys;
pub mod local;
pub mod local_pty;    // ← new
pub mod settings;
pub mod sftp;
pub mod transfer;
pub mod tunnels;
```

- [ ] **Step 3: Register commands in `main.rs`**

In `src-tauri/src/main.rs`, inside `tauri::generate_handler![...]`, add:

```rust
ipc::local_pty::open_local_terminal,
ipc::local_pty::close_local_terminal,
```

Place them near the other session commands (after `ipc::list_sessions`).

- [ ] **Step 4: Verify compile**

```bash
cd src-tauri && cargo check 2>&1 | grep "^error"
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/local_pty.rs src-tauri/src/ipc/mod.rs src-tauri/src/main.rs
git commit -m "feat(ipc): add open_local_terminal / close_local_terminal commands"
```

---

### Task 7: Frontend types + IPC wrappers + settings store

**Files:**
- Modify: `src/types/connection.ts`
- Modify: `src/types/session.ts`
- Modify: `src/types/settings.ts`
- Create: `src/ipc/local_pty.ts`
- Modify: `src/state/settings.ts`

**Interfaces:**
- Consumes: nothing from prior tasks (pure TypeScript)
- Produces:
  - `ConnectionInfo.kind: "ssh" | "local"`
  - `SessionKind = "ssh" | "local"`
  - `Settings.localShell?: string`
  - `openLocalTerminal(): Promise<ConnectionInfo>`, `closeLocalTerminal(id: string): Promise<void>`
  - `useSettingsStore.localShell`, `useSettingsStore.setLocalShell`

- [ ] **Step 1: Update `src/types/connection.ts`**

Find the `ConnectionInfo` interface. Change the `kind` field:

```ts
export interface ConnectionInfo {
  id: ConnectionId;
  label: string;
  kind: "ssh" | "local";    // was: "ssh"
  host_id: string | null;
  state: "active" | "closed";
}
```

- [ ] **Step 2: Update `src/types/session.ts`**

```ts
export type { ConnectionId as SessionId, ConnectionInfo as SessionInfo, OpenConnectionArgs as OpenSshArgs } from "./connection";
export type SessionKind = "ssh" | "local";    // was: "ssh"
```

- [ ] **Step 3: Update `src/types/settings.ts`**

In the `Settings` interface, add `localShell`:
```ts
export interface Settings {
  themeId: "warm-minimal" | "warm-light";
  density: "compact" | "comfortable" | "spacious";
  systemFont: "system-default" | "segoe-ui" | "pingfang-sc" | "microsoft-yahei";
  systemFontSize: number;
  filesFontSize: number;
  terminal: {
    fontFamily: "jetbrains-mono" | "sf-mono" | "fira-code" | "cascadia-code" | "consolas";
    fontSize: number;
    cursorStyle: "block" | "underline" | "bar";
  };
  localShell?: string;
  schemaVersion: 1;
}
```

`DEFAULT_SETTINGS` needs no change (`localShell` is optional, so the existing object is still valid).

- [ ] **Step 4: Create `src/ipc/local_pty.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionInfo } from "../types/connection";

export const openLocalTerminal = (): Promise<ConnectionInfo> =>
  invoke<ConnectionInfo>("open_local_terminal");

export const closeLocalTerminal = (id: string): Promise<void> =>
  invoke<void>("close_local_terminal", { args: { id } });
```

- [ ] **Step 5: Update `src/state/settings.ts`**

In the `State` interface, add:
```ts
localShell: string;
setLocalShell(v: string): void;
```

In `snapshotForSave`:
```ts
function snapshotForSave(s: State): Settings {
  return {
    themeId: s.themeId,
    density: s.density,
    systemFont: s.systemFont,
    systemFontSize: s.systemFontSize,
    filesFontSize: s.filesFontSize,
    terminal: s.terminal,
    localShell: s.localShell || undefined,  // omit from JSON if empty string
    schemaVersion: s.schemaVersion,
  };
}
```

In `create<State>((set, get) => ({...`, add the initial value and action:
```ts
localShell: "",          // empty = use platform default

setLocalShell(v) {
  set({ localShell: v });
  scheduleSave(get);
},
```

In `load()`, after `set({ ...loaded })`:
```ts
set({ ...loaded, localShell: loaded.localShell ?? "" });
```

- [ ] **Step 6: Type-check**

```bash
cd C:\Users\ChenHan\Desktop\shellx && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no new errors related to the changed types. (There may be pre-existing errors — only fix new ones introduced by these changes.)

- [ ] **Step 7: Commit**

```bash
git add src/types/connection.ts src/types/session.ts src/types/settings.ts src/ipc/local_pty.ts src/state/settings.ts
git commit -m "feat(frontend): add local session types, IPC wrappers, and localShell setting"
```

---

### Task 8: `TabBar.tsx` — kind-aware dot + enable "New local terminal"

**Files:**
- Modify: `src/components/TabBar.tsx`

**Interfaces:**
- Consumes: `Tab.kind?: "ssh" | "local"` (new field), `onNewLocalTerminal?: () => void` prop
- Produces: purple dot for local tabs; "New local terminal" menu item is clickable

- [ ] **Step 1: Add `kind` to `Tab` type**

At line 8 in `TabBar.tsx`:
```ts
export type Tab = { id: string; title: string; state?: "active" | "closed"; kind?: "ssh" | "local" };
```

- [ ] **Step 2: Make dot colour kind-aware**

Find the dot `<span>` in the tab render (around line 208):
```tsx
<span style={{
  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
  background: t.state === "closed" ? "var(--text-3)" : "var(--success)",
  opacity: t.state === "closed" ? 0.4 : 1,
}} />
```

Replace with:
```tsx
<span style={{
  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
  background: t.state === "closed"
    ? "var(--text-3)"
    : t.kind === "local" ? "#8B5CF6" : "var(--success)",
  opacity: t.state === "closed" ? 0.4 : 1,
}} />
```

- [ ] **Step 3: Add `onNewLocalTerminal` prop to `TabBar`**

In the `Props` interface (line 10):
```ts
interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseTabs?: (ids: string[]) => void;
  onNewConnection?: () => void;
  onConnectHost?: (host: HostInfo, forceNew?: boolean) => void;
  onNewLocalTerminal?: () => void;    // ← new
}
```

Destructure it:
```tsx
export function TabBar({
  tabs, activeTabId, onSelect, onClose, onCloseTabs, onNewConnection, onConnectHost,
  onNewLocalTerminal,    // ← new
}: Props) {
```

- [ ] **Step 4: Pass `onNewLocalTerminal` to `PlusMenu`**

Find where `PlusMenu` is used (~line 320):
```tsx
{plusOpen && (
  <PlusMenu
    popRef={plusPopRef}
    anchor={plusBtnRef.current}
    savedHosts={savedHosts}
    onNewConnection={() => { setPlusOpen(false); onNewConnection?.(); }}
    onQuickConnect={(host) => { setPlusOpen(false); onConnectHost?.(host); }}
    onNewLocalTerminal={() => { setPlusOpen(false); onNewLocalTerminal?.(); }}   // ← new
  />
)}
```

- [ ] **Step 5: Update `PlusMenu` signature and remove `disabled` from "New local terminal"**

Add `onNewLocalTerminal` to the `PlusMenu` props:
```tsx
function PlusMenu({
  popRef, anchor, savedHosts, onNewConnection, onQuickConnect, onNewLocalTerminal,
}: {
  popRef: React.RefObject<HTMLDivElement>;
  anchor: HTMLButtonElement | null;
  savedHosts: HostInfo[];
  onNewConnection: () => void;
  onQuickConnect: (host: HostInfo) => void;
  onNewLocalTerminal: () => void;    // ← new
}) {
```

Change the "New local terminal" `MenuItem` (currently `disabled` + `badge="Soon"`):
```tsx
<MenuItem
  icon={<TerminalSquare size={14} />}
  label="New local terminal"
  onClick={onNewLocalTerminal}
/>
```

(Remove `disabled` and `badge="Soon"`.)

- [ ] **Step 6: Type-check**

```bash
cd C:\Users\ChenHan\Desktop\shellx && pnpm tsc --noEmit 2>&1 | grep "TabBar" | head -10
```

Expected: no TabBar errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/TabBar.tsx
git commit -m "feat(ui): enable local terminal in + menu, purple dot for local tabs"
```

---

### Task 9: `App.tsx` — wire `openLocalTerminal`, pass `kind` to tabs

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `openLocalTerminal` from `src/ipc/local_pty`, `closeLocalTerminal`, `Tab.kind`
- Produces: clicking "New local terminal" spawns a process and opens a tab; tab close calls `closeLocalTerminal`

- [ ] **Step 1: Find where tabs are derived in `App.tsx`**

Search for where `tabs` prop is built and passed to `<TabBar>`. In `App.tsx`, `sessions` (of type `ConnectionInfo[]`) are mapped to `Tab[]`. Find that mapping.

Look for something like:
```tsx
tabs={sessions.map((s) => ({ id: s.id, title: s.label, state: s.state }))}
```

Add `kind: s.kind` to carry the session kind into the tab:
```tsx
tabs={sessions.map((s) => ({ id: s.id, title: s.label, state: s.state, kind: s.kind }))}
```

- [ ] **Step 2: Import `openLocalTerminal` and `closeLocalTerminal`**

Add import at the top of `App.tsx`:
```ts
import { openLocalTerminal, closeLocalTerminal } from "./ipc/local_pty";
```

- [ ] **Step 3: Add `handleNewLocalTerminal` function**

Add inside the `App` component body, near `handleConnectSavedHost`:
```tsx
async function handleNewLocalTerminal() {
  try {
    const info = await openLocalTerminal();
    addSession(info);
    setActivity(info.id, "terminal");
  } catch (e) {
    setErrorMsg(`Failed to open local terminal: ${e}`);
  }
}
```

- [ ] **Step 4: Update tab close handling for local sessions**

Find where `onClose` is handled for tabs. Currently it calls `closeSession(id)`. Locate the handler and make it also work for local sessions — both `closeSession` and `closeLocalTerminal` route through `close_connection` (same Rust command), so no change is needed here. `closeSession` already calls `close_connection` which the extended `SessionManager.close()` now handles for both kinds.

Verify by reading the handler in App.tsx. If it uses `closeSession(id)` (which calls `close_connection`), it will work for local sessions too. No change needed.

- [ ] **Step 5: Pass `onNewLocalTerminal` to `<TabBar>`**

Find the `<TabBar>` usage in `App.tsx`. Add the new prop:
```tsx
<TabBar
  // ... existing props ...
  onNewLocalTerminal={handleNewLocalTerminal}
/>
```

- [ ] **Step 6: Verify local tabs don't show Files/Tunnels activity tabs**

In `App.tsx`, the `availableTabs` array is derived from `activeHost?.connection_mode`. For a local session, `activeSession.host_id` is `null`, so `activeHost` will be `undefined`, `mode` will be `"terminal_only"`, and `availableTabs` will be `[{ id: "terminal", label: "Terminal" }, { id: "files", label: "Files" }]`. Files tab will be shown but clicking it will fail silently (no SSH connection). 

Add a guard: if the active session kind is `"local"`, only offer the `terminal` tab:
```tsx
const availableTabs: { id: ActivityKind; label: string }[] =
  activeSession?.kind === "local"
    ? [{ id: "terminal", label: "Terminal" }]
    : mode === "tunnels_only"
    ? [{ id: "tunnel", label: "Tunnels" }]
    : mode === "term_tunnels"
    ? [
        { id: "terminal", label: "Terminal" },
        { id: "files", label: "Files" },
        { id: "tunnel", label: "Tunnels" },
      ]
    : [
        { id: "terminal", label: "Terminal" },
        { id: "files", label: "Files" },
      ];
```

- [ ] **Step 7: Type-check**

```bash
cd C:\Users\ChenHan\Desktop\shellx && pnpm tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): wire openLocalTerminal, pass kind to tabs, hide Files/Tunnels for local"
```

---

### Task 10: Settings UI — local shell path input

**Files:**
- Modify: `src/components/settings/AppearancePanel.tsx`
- Modify: `src/components/settings/SettingsSidebar.tsx` (only if a new section is needed — check if "Terminal" already exists)

**Interfaces:**
- Consumes: `useSettingsStore.localShell`, `useSettingsStore.setLocalShell`
- Produces: A text input in Settings → Appearance → Terminal section for the local shell path

- [ ] **Step 1: Read `SettingsSidebar.tsx` to understand the section list**

The sidebar renders navigation links for "appearance", "about", "trusted-servers". The local shell setting belongs under the existing "Appearance" panel in a new "Local Terminal" subsection — no new sidebar entry needed.

- [ ] **Step 2: Find where to add the section in `AppearancePanel.tsx`**

The panel already has a "Terminal" section (font family, font size, cursor style). Add a new "Local terminal" subsection immediately after it, before the closing `</div>` of the panel's scroll container.

- [ ] **Step 3: Add the subsection**

In `AppearancePanel.tsx`, add after the existing Terminal section:

```tsx
<SectionHeader>Local terminal</SectionHeader>

<TwoColField label="Shell">
  <input
    type="text"
    value={localShell}
    onChange={(e) => setLocalShell(e.target.value)}
    placeholder="Default (system shell)"
    style={{
      width: "100%", padding: "4px 8px",
      background: "var(--panel-3, var(--panel-2))",
      border: "0.5px solid var(--border)",
      borderRadius: 4, color: "var(--text-1)",
      fontSize: "var(--font-ui-size)",
      fontFamily: "var(--font-ui)",
    }}
  />
  <div style={{ fontSize: FS_META, color: "var(--text-3)", marginTop: 4 }}>
    Leave blank to use the system default (cmd.exe on Windows, $SHELL on macOS/Linux).
    Example: <code>C:\Windows\System32\PowerShell\v1.0\powershell.exe</code>
  </div>
</TwoColField>
```

At the top of `AppearancePanel`, add:
```tsx
const localShell = useSettingsStore((s) => s.localShell);
const setLocalShell = (v: string) => useSettingsStore.getState().setLocalShell(v);
```

- [ ] **Step 4: Type-check**

```bash
cd C:\Users\ChenHan\Desktop\shellx && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Run existing settings tests**

```bash
cd C:\Users\ChenHan\Desktop\shellx && pnpm test -- --testPathPattern="settings" 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/AppearancePanel.tsx
git commit -m "feat(settings): add local shell path input in Appearance panel"
```

---

### Task 11: Full compile + manual smoke test

**Files:** none — verification only

- [ ] **Step 1: Full Rust build**

```bash
cd src-tauri && cargo build 2>&1 | grep "^error" | head -20
```

Expected: no errors.

- [ ] **Step 2: Full TypeScript check**

```bash
cd C:\Users\ChenHan\Desktop\shellx && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Run all Rust tests**

```bash
cd src-tauri && cargo test 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 4: Run frontend tests**

```bash
cd C:\Users\ChenHan\Desktop\shellx && pnpm test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 5: Launch Tauri and smoke test**

```powershell
Start-Process -FilePath "cmd.exe" -ArgumentList "/c","pnpm tauri:dev > $env:TEMP\tauri-out.log 2>&1" -WorkingDirectory "C:\Users\ChenHan\Desktop\shellx" -WindowStyle Hidden
```

Manual test checklist:
1. Click `+` — verify "New local terminal" is clickable (no "Soon" badge, no grey-out)
2. Click "New local terminal" — verify a new tab appears with a purple dot and title "Local Terminal"
3. Type a command (e.g., `echo hello`) — verify output appears in the terminal
4. Type `exit` — verify the tab closes automatically
5. Open two local terminal tabs — verify they're independent
6. Settings → Appearance → scroll to "Local terminal" — verify the shell path input renders
7. Type a path in the shell field, close the app, reopen — verify the setting persists
8. SSH tab and local tab open simultaneously — verify SSH dot is green, local dot is purple

- [ ] **Step 6: Final commit if no issues found**

```bash
git add .
git status
# Verify nothing unexpected is staged
git commit -m "chore: final smoke-test verified — local PTY terminal feature complete"
```

# shellx

**English** · [简体中文](./README.zh-CN.md)

A tiny, pretty, extensible terminal + file-transfer client. Cross-platform (Windows / macOS / Linux), open source, built on Tauri + Rust + React.

## Status: v0.5.5

v0.5.5 is a polish + robustness pass: a proper `DisconnectedPanel` when a
Files-view session dies (with a one-click Reconnect using saved credentials),
muted-sage terminal green so `ls`'s other-writable directory colouring is
finally readable, host-delete cascades to its live tabs + panes, host drawer
auto-hides when empty, `New SSH connection` field labels no longer wash out,
and `PathBreadcrumb`'s `C:` chip actually navigates to the drive root.
Everything below still applies:

v0.5.4 widened the activity rail (icon + label under each button) and made
empty patches of the tab strip a window-drag surface.

The **Settings / Appearance** panel and titlebar in v0.5.3:

- **System font size** slider (11–16 px) — scales every sans UI surface (tabs, sidebar rows, host list,
  right-click menus, buttons, Terminal | Files toggle). Terminal font stays on its own scale.
- **System font family** picker — System default, Segoe UI, PingFang SC, Microsoft YaHei.
- **Themes**: **Warm Minimal** + **Warm Light** (dropped Ocean and Forest; stale `settings.json` values
  auto-migrate).
- **Density**: Compact / Comfortable / Spacious — controls list-row padding + monospace content size.
- **Terminal**: font family (JetBrains Mono, SF Mono, Fira Code, Cascadia Code, Consolas), size (10–20 px),
  cursor style (block / underline / bar). xterm reconfigures live and re-fits cols/rows without remount.
- **Tab bar overflow chrome** — when tabs exceed the titlebar width, a compact cluster `‹ › ≡` appears at
  the right end (chevrons scroll the strip; list icon opens a per-row-close dropdown). Wheel scroll on the
  strip. Right-click any tab for `Close N to the left` / `Close N to the right` / `Close all`.

Settings persist to a JSON file in the app config directory (debounced autosave on the Rust side) and are restored on next launch.

Also includes the **custom titlebar** (landed in v0.4.3): tabs integrated into the titlebar itself, app logo,
and native-feeling window controls, replacing the OS-drawn title bar on all three platforms.

Also includes all v0.4 features: Rail Files (WinSCP-style dual-pane local ↔ remote file browser), drag-and-drop
transfers, splitter reset, drawer collapse (`Ctrl+Shift+B` / `Cmd+B`); and all v0.3 features: SFTP alongside SSH
in the same tab, Connection/ShellHandle/SftpHandle trait hierarchy, drag-drop upload, right-click CRUD,
dead-tab fade, Ctrl+Shift+W/T hotkey remap (Ctrl+W/T remain shell/tmux bindings), Forget-password UI, and
HostRow keyboard a11y.

> **Security note (v0.5)**: shellx still does not verify SSH host keys — every server is trusted on first
> connection. Do not use over untrusted networks yet. Host-key TOFU + pubkey auth remain on the v0.6+ backlog
> below.

---

## Prerequisites

Install these once, in this order:

| Tool          | Version         | Install                                                                                                                            |
| ------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js**   | 20 LTS or newer | [nodejs.org](https://nodejs.org/) · verify with `node --version`                                                                   |
| **pnpm**      | 9.x or newer    | `npm i -g pnpm` · verify with `pnpm --version`                                                                                     |
| **Rust**      | 1.77 or newer   | [rustup.rs](https://rustup.rs/) · installs the `stable-msvc` toolchain on Windows · verify with `cargo --version && rustc --version` |
| **WebView2**  | any             | Pre-installed on Windows 11; on Windows 10 the [Evergreen Runtime installer](https://developer.microsoft.com/microsoft-edge/webview2/) is a one-time install |

Platform notes:

- **Windows**: You need the Visual Studio Build Tools (C++ workload) so Rust's `msvc` toolchain can link native crates. rustup usually installs this for you the first time.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` (Debian/Ubuntu package names).

---

## First-time setup

```bash
git clone <this-repo>
cd shellx
pnpm install       # installs frontend deps (React, Vite, xterm.js, Zustand, etc.)
```

The first `pnpm tauri:dev` (or `pnpm tauri:build`) will additionally download and compile all Rust dependencies — that first compile takes 5–15 minutes on a warm connection and produces a ~2 GB `src-tauri/target/` directory. Subsequent builds are incremental (seconds).

**Behind the Great Firewall (or on any slow crates.io mirror):** the project already ships a `src-tauri/.cargo/config.toml` pointing cargo at `rsproxy.cn`. You don't need to configure anything.

---

## Development workflow

### Run the app in dev mode (hot reload)

```bash
pnpm tauri:dev
```

- Starts Vite dev server on port 1420 (auto-reload on frontend changes).
- Compiles `src-tauri/` and launches the native window (auto-restart on Rust changes).
- Close the window to exit cleanly.

### Keyboard shortcuts

| Action              | Windows / Linux    | macOS         |
| -------------------- | ------------------- | ------------- |
| New tab              | `Ctrl+Shift+T`       | `Cmd+T`        |
| Close tab            | `Ctrl+Shift+W`       | `Cmd+W`        |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Command palette      | `Ctrl+K`             | `Cmd+K`        |
| Toggle sidebar (drawer) | `Ctrl+Shift+B`    | `Cmd+B`        |

Windows/Linux require Shift on New/Close tab (v0.3) so they don't collide with terminal-inside-terminal
muscle memory (`Ctrl+T`/`Ctrl+W` are common shell/tmux bindings); tab switching is unaffected.

### Type-check the frontend

```bash
pnpm tsc --noEmit
```

Fast (<5 s) — run this before committing UI changes.

### Type-check + build the frontend without launching

```bash
pnpm build
```

Emits `dist/` (what Tauri packages into the app). Rarely needed by hand.

### Type-check the Rust backend without a full build

```bash
cd src-tauri && cargo check --lib && cargo check --bin shellx
```

---

## Building for release

```bash
pnpm tauri:build
```

Produces platform-native installers under `src-tauri/target/release/bundle/`:

- **Windows**: `bundle/msi/shellx_<version>_x64_en-US.msi` and `bundle/nsis/shellx_<version>_x64-setup.exe`
- **macOS**: `bundle/dmg/shellx_<version>_universal.dmg`
- **Linux**: `bundle/appimage/shellx_<version>_amd64.AppImage`, `bundle/deb/shellx_<version>_amd64.deb`, `bundle/rpm/shellx-<version>-1.x86_64.rpm`

Release builds enable LTO and take longer (5–15 min on Windows) than dev.

---

## Testing

```bash
# Rust unit tests
cd src-tauri && cargo test --lib

# Rust end-to-end integration tests (open in-process SSH/SFTP server fixtures)
cd src-tauri && cargo test --features test-fixtures --test ssh_integration
cd src-tauri && cargo test --features test-fixtures --test sftp_integration

# Frontend tests (Vitest + jsdom + Testing Library)
pnpm test -- --run
```

The Rust integration tests do not need Docker or an external SSH server — they spin up an in-process russh (and russh-sftp) server inside the test itself. See `src-tauri/src/protocol/ssh.rs::testing::start_echo_ssh_server` for the fixture.

### Trying it against a real server

Any SSH server works. To spin up a throwaway one:

```bash
docker run --rm -p 2222:22 -e USER_PASSWORD=test linuxserver/openssh-server:latest
```

Then in the app: **＋ New connection**, fill `Host: 127.0.0.1`, `Port: 2222`, `Username: linuxserver.io`, `Password: test` (check the container log for the actual generated credentials).

---

## Project layout

```
shellx/
├── src/                            # React + TypeScript frontend
│   ├── App.tsx                     # Root — wires AppShell + ConnectDialog + store
│   ├── main.tsx                    # Vite entry (imports design tokens)
│   ├── styles/                     # Warm Minimal CSS tokens + reset
│   ├── components/                 # UI: AppShell, ActivityRail, Drawer, TabBar,
│   │                               #     TerminalView, ConnectDialog, EmptyState
│   ├── ipc/                        # Typed wrappers around Tauri invoke() / listen()
│   ├── state/                      # Zustand store (session list, active id)
│   └── types/                      # Shared TS types
│
├── src-tauri/                      # Rust backend
│   ├── src/
│   │   ├── main.rs                 # Tauri app entry (registers commands, manages state)
│   │   ├── lib.rs                  # Module root
│   │   ├── transport/              # Byte-stream layer (Transport trait, TcpTransport)
│   │   ├── protocol/               # App-protocol layer (SshProtocol via russh)
│   │   ├── session/                # SessionManager (owns live sessions, driver_loop)
│   │   ├── ipc/                    # #[tauri::command] handlers + event payloads
│   │   └── error.rs                # Result<T> and Error enum (Serialize for JS)
│   ├── tests/ssh_integration.rs    # End-to-end test through SessionManager
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── .cargo/config.toml          # rsproxy.cn mirror config
│
├── docs/superpowers/
│   ├── specs/                      # Design spec (v0.1 through v1.0 roadmap)
│   └── plans/                      # Per-milestone implementation plans
│
└── .superpowers/sdd/               # SDD ledger + per-task briefs and reports
    (excluded via .gitignore)       # (per-run scratch, safe to delete)
```

### Three-layer architecture

The Rust side is split into three trait-bounded layers, each independently testable:

- **Transport** (`transport::Transport` trait) — bytes only. Currently `TcpTransport`; future `SerialTransport` (RS-232 / RS-485), `UsbCdcTransport`, `WsTransport` slot in here without touching upper layers.
- **Protocol** (`protocol::Connection` trait, implemented by `SshConnection`; a connection opens `ShellHandle` and/or `SftpHandle` sub-channels) — turns bytes into semantic operations (auth, channels, PTY/resize, SFTP CRUD + transfers). The trait boundary keeps room for a future FTP/FTPS implementation (v0.5) without touching `SessionManager`.
- **SessionManager** (`session::manager::SessionManager`) — owns live sessions keyed by UUID; runs a per-session tokio task that pumps writes / reads / subscription forwarding. Exposed to the frontend via Tauri IPC commands + events (`session:data`, `session:closed`).

Adding a new physical channel (e.g. RS-485) means writing one `Transport` impl. Adding a new application protocol (e.g. Modbus, MQTT) means writing a session type that plugs into `SessionManager`. Adding a new UI view (e.g. a Modbus register table) means writing one React component and one command dispatch. See spec §5 for the planned extension timeline.

---

## Sizes (v0.5)

Measured from a `pnpm tauri:build` release build on Windows 11 (MSVC toolchain):

- Windows MSI: 7.2 MB (`shellx_0.5.0_x64_en-US.msi`)
- Windows NSIS setup: 4.5 MB (`shellx_0.5.0_x64-setup.exe`)
- macOS DMG: not yet measured (no macOS build machine in this pass)
- Linux AppImage: not yet measured (no Linux build machine in this pass)

Both Windows installers remain well under the 15 MB target (spec §7). The v0.4 → v0.5 growth is
~0.4 MB on both installers — larger than the two new `@fontsource` packages' CSS alone would
suggest, since each package ships woff2 files for every Unicode subset of its 400-weight face,
not just the single `400.css` entry point that's imported. Still comfortably within budget.

---

## Troubleshooting

**`error: Missing manifest in toolchain 'stable-x86_64-pc-windows-msvc'`** or `cargo` works but `rustc` doesn't — the toolchain was interrupted mid-install (Windows Defender often does this):

```bash
rustup toolchain uninstall stable
rustup toolchain install stable --profile minimal --force
rustup component add cargo rust-std      # if the reinstall drops any component
cargo --version && rustc --version        # both should print now
```

If downloads fail with `os error 2` file rename mid-transfer, that's Defender racing with rustup — export `RUSTUP_DIST_SERVER=https://rsproxy.cn` and `RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup` before retrying (the faster mirror shortens the window).

**`warning: output filename collision at ... shellx.pdb`** — benign. The `[lib]` and `[[bin]]` targets share the crate name `shellx`; on Windows they collide on debug-info filenames only. Build succeeds, binary runs. See [rust-lang/cargo#6313](https://github.com/rust-lang/cargo/issues/6313) for the upstream issue.

**App compiles but panics at launch with `SetLoggerError`** — was fixed in `be85531`. If it recurs after adding a new logger init, remember `tauri_plugin_log` already owns the global logger slot; don't call `tracing_subscriber::init()` alongside it.

**Frontend tests print jsdom canvas errors from xterm.js** — noise, not failures. `jsdom` doesn't implement `<canvas>` fully; xterm.js prints stack traces to stderr but the tests still pass (`52 passed`).

**Windows Defender flags the built exe** — it's an unsigned binary. Code signing is a v1.0 concern; for now, right-click → Properties → **Unblock** if you want to distribute.

---

## Contributing / working on this next

The next natural steps (roughly the order of the spec's milestone roadmap):

- **v0.4** ✓ — Rail Files (dual-pane local ↔ remote browser), auto-select new connections as remote host, 8 local IPC commands.
- **v0.5** ✓ — Settings / Appearance panel (theme + density + terminal font/size/cursor, live-applied, JSON-persisted), custom titlebar (v0.4.3).

### v0.6+ Backlog

- **Settings: Advanced page** — keyboard-shortcut remapping, log level, telemetry toggle.
- **Rethink the purple accent** — `#7c5cff` reads harsh in rail icons and selected states; explore a softer accent variant (still on-brand) or expose accent hue as a Setting.
- **Files-pane content font size** — currently governed by density's `--font-body`; add an explicit Files font-size slider in Appearance → Files, parallel to Terminal font size, so remote/local browsing scales independently.
- **PaneSplitter min-width guard** — the Files splitter can be dragged into unusable narrow panes; enforce a minimum (e.g. 200 px per side) with soft snap on release.
- **Security posture roadmap** — beyond host-key TOFU + pubkey auth already listed: audit path-sanitisation on remote-supplied strings, review keychain fallback modes, and land a written threat-model document.
- **Protocols page design** — currently a `coming soon` placeholder; before v0.7 scope what it actually is (list of registered transport / protocol implementations? per-protocol activation UI? live health of each session's protocol layer?).
- **Host-key TOFU + known_hosts persistence** — trust-on-first-use SSH host-key verification; save fingerprints to `~/.ssh/known_hosts`.
- **Public-key authentication** — RSA / Ed25519 key pairs with passphrase in system keychain.
- **Installer code signing** — Windows authenticode + macOS notarization.
- **Drag-drop row transfer** — dragging a specific file row should transfer only that row, not the entire current selection.
- **Cargo.toml authors field** — replace `authors = ["you"]` placeholder with actual maintainer names.
- **Hidden-file filter** — toggle to show/hide dotfiles in local and remote panes.
- **Upload conflict dialog** — prompt user when overwriting existing remote files.
- **v0.7+** — traditional FTP / FTPS, signed cross-platform CI.
- **Future** — RS-232 / RS-485 transport, Modbus RTU/TCP protocol, custom register-table views (spec §4 shows exactly which layer each addition touches).

The design spec and implementation plan directories under `docs/superpowers/` are the source of truth for how each milestone is scoped; the SDD ledger under `.superpowers/sdd/` is the retrospective for how each was built.

---

## License

MIT — see [`LICENSE`](LICENSE).

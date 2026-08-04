# shellx

A tiny, pretty, extensible terminal + file-transfer client. Cross-platform (Windows / macOS / Linux), open source, built on Tauri + Rust + React.

## Status: v0.2

v0.2 adds a persistent connection manager (SQLite hosts + OS keychain passwords), multi-tab
SSH with Ctrl+T/W/Tab shortcuts, a minimal ⌘K palette to search saved hosts, and a first UI
polish pass (Lucide icons, JetBrains Mono terminal with a Custom Warm ANSI palette, a real
`>_` app icon). See [docs/superpowers/specs/2026-08-04-shellx-v0.2-design.md](docs/superpowers/specs/2026-08-04-shellx-v0.2-design.md) for the full design.

> **Security note (v0.2)**: shellx does not verify SSH host keys — every server is trusted on first connection. Do not use over untrusted networks yet. Host-key verification lands in v0.3.

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

# Rust end-to-end integration test (opens an in-process SSH server fixture)
cd src-tauri && cargo test --features test-fixtures --test ssh_integration

# Frontend tests (Vitest + jsdom + Testing Library)
pnpm test -- --run
```

The Rust integration test does not need Docker or an external SSH server — it spins up an in-process russh echo server inside the test itself. See `src-tauri/src/protocol/ssh.rs::testing::start_echo_ssh_server` for the fixture.

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
- **Protocol** (currently `SshProtocol` concrete; `Protocol` trait deferred to v0.3 when SFTP/FTP force the abstraction) — turns bytes into semantic operations (auth, channels, PTY, resize).
- **SessionManager** (`session::manager::SessionManager`) — owns live sessions keyed by UUID; runs a per-session tokio task that pumps writes / reads / subscription forwarding. Exposed to the frontend via Tauri IPC commands + events (`session:data`, `session:closed`).

Adding a new physical channel (e.g. RS-485) means writing one `Transport` impl. Adding a new application protocol (e.g. Modbus, MQTT) means writing a session type that plugs into `SessionManager`. Adding a new UI view (e.g. a Modbus register table) means writing one React component and one command dispatch. See spec §5 for the planned extension timeline.

---

## Sizes (v0.2)

Measured from a `pnpm tauri:build` release build on Windows 11 (MSVC toolchain):

- Windows MSI: 6.1 MB (`shellx_0.2.0_x64_en-US.msi`, 6,352,896 bytes)
- Windows NSIS setup: 3.8 MB (`shellx_0.2.0_x64-setup.exe`, 3,956,675 bytes)
- macOS DMG: not yet measured (no macOS build machine in this pass)
- Linux AppImage: not yet measured (no Linux build machine in this pass)

Both Windows installers are well under the 15 MB target (spec §7).

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

**Frontend tests print jsdom canvas errors from xterm.js** — noise, not failures. `jsdom` doesn't implement `<canvas>` fully; xterm.js prints stack traces to stderr but the tests still pass (`4 passed`).

**Windows Defender flags the built exe** — it's an unsigned binary. Code signing is a v1.0 concern; for now, right-click → Properties → **Unblock** if you want to distribute.

---

## Contributing / working on this next

The next natural steps (roughly the order of the spec's milestone roadmap):

- **v0.3** — SFTP (rides SSH channel), SSH key-based auth, host-key verification (known_hosts), `Protocol` trait extraction.
- **v0.4** — traditional FTP / FTPS.
- **v0.5+** — optional master-password double-track for credentials, signed installers, cross-platform CI, light theme.
- **Future** — RS-232 / RS-485 transport, Modbus RTU/TCP protocol, custom register-table views (spec §4 shows exactly which layer each addition touches).

The design spec and implementation plan directories under `docs/superpowers/` are the source of truth for how each milestone is scoped; the SDD ledger under `.superpowers/sdd/` is the retrospective for how each was built.

---

## License

MIT — see [`LICENSE`](LICENSE).

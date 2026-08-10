# shellx

**English** · [简体中文](./README.zh-CN.md)

A tiny, pretty terminal + file-transfer client — cross-platform (Windows / macOS / Linux), open source, built on Tauri + Rust + React.

Current release: **v0.7.0** — see [`docs/release-notes/`](docs/release-notes/) for what changed.

---

## 1. What is shellx

shellx is a desktop app that gives you:

- **SSH terminal** in tabs — connect to Linux / BSD / macOS servers, get a working shell with themes, custom fonts, cursor style; public-key (Ed25519/RSA/ECDSA) or password auth, host-key verification against `~/.ssh/known_hosts`
- **SFTP file browser** — WinSCP-style dual-pane (local ↔ remote) with drag-and-drop upload / download, folder transfers, pause / resume / cancel
- **Saved hosts + keychain** — store your servers once, quick-connect from the sidebar or the `+` menu; passwords live in the OS keychain, not a plaintext config

It's a single ~7 MB installer with no runtime dependencies (Tauri bundles a small Rust binary and reuses the OS-native webview instead of shipping Chromium — that's why it's small).

---

## 2. Architecture

shellx has two halves and a boundary between them.

<img src="docs/architecture.svg" alt="shellx architecture" width="100%">

### The frontend

`src/` is a Vite-built React app in TypeScript. Nothing in it talks to the network directly — every remote / local IO call goes through a thin `ipc/*.ts` wrapper that calls the Rust backend via Tauri's `invoke()`. State lives in Zustand stores (`src/state/`) — sessions list, saved hosts, ongoing transfers, appearance settings.

### The backend

`src-tauri/src/` is a Rust binary crate wrapped by Tauri. It exposes a set of `#[tauri::command]` functions (`src-tauri/src/ipc/`) that the frontend calls. The interesting layers behind that:

- **transport/** — bytes over the wire. Just TCP today; the trait is designed so RS-232 / WebSocket can plug in without touching upper layers.
- **protocol/** — SSH (via [`russh`](https://github.com/warp-tech/russh)) and SFTP. Auth, PTYs, channels, resize, file transfers.
- **session::SessionManager** — owns every live connection keyed by UUID. Each session runs a dedicated `tokio` task that pumps bytes between the network and the frontend (via `session:data` / `session:closed` Tauri events).
- **local/** — host filesystem: list, mkdir, rename, copy, disk enumeration for the disk picker.

### Communication

- **Command → response**: frontend calls `invoke("sftp_upload", args)`; Rust runs the handler, returns a JSON-serializable result or error.
- **Server → client stream**: Rust `emit`s Tauri events (`session:data`, `transfer:progress`, `transfer:done`, `connection:closed`, …); frontend `listen`s and updates the store.

That's the whole picture. Add a new file operation? Write one command in `src-tauri/src/ipc/`, one wrapper in `src/ipc/`. Add a new transport? Implement the trait in `src-tauri/src/transport/`.

---

## 3. Running shellx locally

This section is for developers who want to build and run shellx from source. **You don't need to know Rust or Tauri** — the tooling handles almost everything. You do need to install a few things once.

### 3.1 Install the tooling (one-time)

**All platforms — Node.js + pnpm** (for the frontend):

1. Install Node.js 20 LTS or newer from [nodejs.org](https://nodejs.org/). Verify:

   ```bash
   node --version
   ```

2. Install pnpm globally:

   ```bash
   npm install -g pnpm
   pnpm --version
   ```

**All platforms — Rust** (for the backend). Rust ships with a tool called `cargo` which is like `npm` for Rust. You install both at once via `rustup`:

- **Windows / macOS / Linux — the one-command install**:

  Go to [rustup.rs](https://rustup.rs/) and follow the on-screen instructions. It's a single command:

  ```bash
  # macOS / Linux
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

  ```powershell
  # Windows — download and run rustup-init.exe from https://rustup.rs/
  ```

  Accept the defaults. When it's done, close and reopen your terminal, then verify:

  ```bash
  cargo --version    # e.g. cargo 1.83.0
  rustc --version    # e.g. rustc 1.83.0
  ```

**Platform-specific extras**:

| OS      | You also need                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Windows | **Visual Studio Build Tools** (C++ workload). `rustup` will offer to install it the first time — accept. **WebView2** is pre-installed on Windows 11; on Windows 10 install the [Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). |
| macOS   | **Xcode Command Line Tools** — `xcode-select --install`.                                              |
| Linux   | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` (Debian/Ubuntu; other distros: [Tauri prerequisites](https://tauri.app/start/prerequisites/)). |

### 3.2 Get the code + install frontend deps

```bash
git clone <this-repo>
cd shellx
pnpm install
```

That downloads all the frontend dependencies (React, xterm.js, Zustand, etc.) into `node_modules/`.

Rust dependencies are downloaded automatically the first time you build — you don't `cargo install` anything by hand.

### 3.3 Run the app in dev mode

```bash
pnpm tauri:dev
```

What happens:

1. Vite starts a dev server on port 1420 (auto-reload on frontend file changes).
2. Cargo compiles the Rust backend. **The first build takes 5–15 minutes** and downloads ~2 GB of Rust dependencies into `src-tauri/target/`. Every build after that is incremental — seconds.
3. A native desktop window opens with the shellx app. Edit any React file → HMR live-reloads. Edit any Rust file → Tauri rebuilds and relaunches automatically.

Close the window to stop the dev server.

> **Slow crates.io / GFW users**: the repo already includes `src-tauri/.cargo/config.toml` pointing cargo at `rsproxy.cn`. No config needed.

### 3.4 Build a release installer

```bash
pnpm tauri:build
```

Produces a native installer under `src-tauri/target/release/bundle/`:

- **Windows**: `bundle/msi/shellx_<version>_x64_en-US.msi` and `bundle/nsis/shellx_<version>_x64-setup.exe`
- **macOS**: `bundle/dmg/shellx_<version>_universal.dmg`
- **Linux**: `bundle/appimage/shellx_<version>_amd64.AppImage`, `bundle/deb/shellx_<version>_amd64.deb`, `bundle/rpm/shellx-<version>-1.x86_64.rpm`

Release builds are 5–15 min on a warm cache (LTO is on).

### 3.5 Tests

```bash
# Frontend tests (Vitest + Testing Library)
pnpm test --run

# Rust unit tests
cd src-tauri && cargo test --lib

# Rust integration tests (in-process SSH / SFTP fixtures — no Docker needed)
cd src-tauri && cargo test --features test-fixtures --test ssh_integration
cd src-tauri && cargo test --features test-fixtures --test sftp_integration
```

TypeScript typecheck:

```bash
pnpm tsc --noEmit
```

---

## Keyboard shortcuts

| Action                  | Windows / Linux                  | macOS                            |
| ----------------------- | -------------------------------- | -------------------------------- |
| New tab                 | `Ctrl+Shift+T`                   | `Cmd+T`                          |
| Close tab               | `Ctrl+Shift+W`                   | `Cmd+W`                          |
| Next / previous tab     | `Ctrl+Tab` / `Ctrl+Shift+Tab`    | `Ctrl+Tab` / `Ctrl+Shift+Tab`    |
| Command palette         | `Ctrl+K`                         | `Cmd+K`                          |
| Toggle sidebar drawer   | `Ctrl+Shift+B`                   | `Cmd+B`                          |

Windows/Linux use `Ctrl+Shift+T` / `Ctrl+Shift+W` (not `Ctrl+T` / `Ctrl+W`) so they don't collide with terminal-inside-terminal muscle memory (`Ctrl+T` and `Ctrl+W` are common bash/tmux bindings).

---

## Troubleshooting

**`error: Missing manifest in toolchain 'stable-…'`** — the Rust toolchain install was interrupted (Windows Defender often does this). Fix:

```bash
rustup toolchain uninstall stable
rustup toolchain install stable --profile minimal --force
rustup component add cargo rust-std
cargo --version && rustc --version
```

**Downloads keep failing with `os error 2` mid-transfer** — Defender racing with rustup. Set `RUSTUP_DIST_SERVER=https://rsproxy.cn` and `RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup` before retrying.

**`warning: output filename collision at ... shellx.pdb`** — benign; `[lib]` and `[[bin]]` share the crate name. Build succeeds. See [rust-lang/cargo#6313](https://github.com/rust-lang/cargo/issues/6313).

**Windows Defender flags the built exe** — it's unsigned. Code signing is on the v1.0 roadmap; for now, right-click → Properties → **Unblock**.

---

## License

MIT — see [`LICENSE`](LICENSE).

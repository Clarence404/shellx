# shellx

A tiny, pretty, extensible terminal + file-transfer client.

## Status: v0.1 (foundation)

Not yet functional. See `docs/superpowers/specs/2026-08-03-shellx-design.md`.

## Build

Requires: Node 20+, pnpm 9+, Rust 1.77+.

```bash
pnpm install
pnpm tauri:dev
```

## Sizes (v0.1)

Measured from a `pnpm tauri:build` release build on Windows 11 (MSVC toolchain):

- Windows MSI: 4.0 MB (`shellx_0.1.0_x64_en-US.msi`, 4,235,264 bytes)
- Windows NSIS setup: 2.8 MB (`shellx_0.1.0_x64-setup.exe`, 2,917,231 bytes)
- macOS DMG: not yet measured (no macOS build machine in this pass)
- Linux AppImage: not yet measured (no Linux build machine in this pass)

Both Windows installers are well under the 15 MB target (spec §7).

## Testing locally

Any SSH server works. To spin up a throwaway one on Windows/macOS/Linux:

    docker run --rm -p 2222:22 -e USER_PASSWORD=test linuxserver/openssh-server:latest

Then connect with `Host: 127.0.0.1  Port: 2222  User: linuxserver.io  Password: test` (see the container's log for the actual credentials).

For automated tests, `src-tauri/src/protocol/ssh.rs` exposes an in-process
echo SSH server fixture (`protocol::ssh::testing::start_echo_ssh_server`,
behind the `test-fixtures` feature) — no Docker or external server needed.
See `src-tauri/tests/ssh_integration.rs` for an example that opens a session,
writes, reads, and closes it end-to-end through `SessionManager`.

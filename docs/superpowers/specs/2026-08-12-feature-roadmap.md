# shellx Feature Roadmap — v0.14 → v1.0

Status: approved 2026-08-12. One main course per release, alternating
product features with open-source launch infrastructure. Each release is an
independently shippable cycle following the repo's branch → verify → merge →
tag workflow.

## Goals

1. Cover the owner's four daily high-frequency needs: remote/dynamic
   forwarding, jump hosts, command snippets, serial debugging.
2. Build the open-source launch foundation in parallel: onboarding
   (ssh-config import), retention (auto-update), trust (signing, docs).

## Release plan

### v0.14 — Tunnel completeness: -R remote + -D dynamic (SOCKS) forwarding

- Data model: `tunnels` table gains a `kind` column
  (`local` | `remote` | `dynamic`); existing rows migrate to `local`.
- Backend: russh supports both natively — `-R` via `tcpip_forward` +
  incoming `forwarded-tcpip` channels; `-D` via a local SOCKS5 listener
  bridging to `direct-tcpip`.
- UI: kind selector in add/edit rule forms; per-kind badge and field
  layout in TunnelsPanel and the host dialog (remote: remote_port →
  local target; dynamic: local port only).
- SSH import/export extended to parse and emit `-R` / `-D`.
- Rationale for going first: smallest delta on top of the existing tunnel
  stack; takes tunnels from 1/3 to 3/3 of the standard triple.

### v0.15 — ssh-config import + config export

- Import `~/.ssh/config`: Host blocks → saved hosts (HostName, User, Port,
  IdentityFile, ProxyJump recorded for v0.16). Conflict strategy: skip
  existing labels, report a summary.
- Export/import shellx config as a JSON bundle: hosts, tunnel rules,
  settings, snippets (when they exist). Passwords/passphrases stay in the
  OS keychain and are explicitly NOT exported; the bundle marks which
  hosts had stored secrets so the importer can prompt.
- Rationale: the first thing a new open-source user does is migrate
  existing hosts — first-impression feature; export doubles as machine
  migration.

### v0.16 — Jump host (ProxyJump)

- `hosts` gains `jump_host_id` (nullable FK to another saved host).
- Connect chain: connect to the jump host, then open `direct-tcpip` to the
  target and run the SSH handshake through it (russh supports channel
  streams as transport). One jump level in v0.16; chains later if needed.
- UI: Basic tab gains a "Jump host" picker (saved hosts list, none by
  default). Import/export understands `-J user@host[:port]` and
  ssh-config `ProxyJump`.
- Cycle detection: a host cannot (transitively) jump through itself.

### v0.17 — Auto-update

- tauri-plugin-updater against GitHub Releases; updater signing keypair
  generated and the public key baked into tauri.conf.json.
- Release workflow uploads `.sig` + `latest.json` artifacts.
- Settings → About: current version, check-for-updates button,
  install-on-restart flow. Opt-out toggle.

### v0.18 — Command snippets

- SQLite `snippets` table: label, body (multi-line), sort order.
- `${placeholder}` variables prompt on send; sends to the active terminal
  session (SSH or local).
- Surfaces: command palette entries and a snippets popover in the terminal
  toolbar; per-snippet "send on connect" flag deferred.

### v0.19 — Serial terminal

- Backend: serialport-rs transport implementing the existing transport
  trait; device enumeration IPC (COM ports / ttyUSB).
- Session kind `serial` reuses the xterm frontend and tab model.
- Serial rail view becomes real: device list + connection profile
  (baud rate, data bits, parity, stop bits, flow control), saved profiles.
- Largest single item (new transport + new config surface) — scheduled
  after the connectivity features land.

### v1.0 — Launch polish

- Installer signing (Windows cert has cost; interim: winget/scoop
  distribution to bypass SmartScreen).
- README screenshots refresh, project site/landing page, CONTRIBUTING,
  issue templates.
- Customizable keybindings (Settings → Shortcuts becomes editable).
- Stability pass over accumulated bug reports.

## Sequencing rationale

- `-R/-D` leads on cost/benefit, not importance: cheapest item with the
  highest completeness payoff.
- Jump host outranks snippets: connectivity beats convenience — without it
  some hosts are unreachable, without snippets things are merely slower.
- Auto-update deliberately lands after the first user-facing wave
  (v0.15 brings the first migrants) and before the later features, so
  users stop manually reinstalling from v0.17 on.
- Serial closes the feature tier as the largest single scope.

## Out of scope (revisit after v1.0)

- Multi-session broadcast, Zmodem (rz/sz), session recording/logging,
  SFTP remote-edit-with-local-editor, host groups/folders, settings sync
  over network.

## Process

Each release follows the standing workflow: feature branch → user visual
verification → explicit 发版 approval → merge to main → bump versions →
release notes (+ README sync when user-visible) → tag → CI installers.
Detailed per-release design happens at cycle start via brainstorming →
spec → implementation plan.

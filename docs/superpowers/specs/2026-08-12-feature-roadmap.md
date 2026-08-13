# shellx Feature Roadmap — v0.14 → v1.0

Status: approved 2026-08-12, revised same day — -R/-D forwarding and jump
host (ProxyJump) both dropped from the near-term plan (no real-world demand
from the owner's workflow; deferred until a concrete need appears). One
main course per release. Each release is an independently shippable cycle
following the repo's branch → verify → merge → tag workflow.

## Goals

1. Cover the owner's daily high-frequency needs: command snippets, serial
   debugging.
2. Build the open-source launch foundation: retention (auto-update),
   onboarding (ssh-config import), trust (signing, docs).

## Release plan

### v0.14 — Auto-update

- tauri-plugin-updater against GitHub Releases; updater signing keypair
  generated and the public key baked into tauri.conf.json.
- Release workflow uploads `.sig` + `latest.json` artifacts.
- Settings → About: current version, check-for-updates button,
  install-on-restart flow. Opt-out toggle.
- Rationale for going first: pure infrastructure with no schema changes,
  and every release after it reaches users automatically — the earlier it
  ships, the more releases benefit.

### v0.15 — ssh-config import + config export

- Import `~/.ssh/config`: Host blocks → saved hosts (HostName, User, Port,
  IdentityFile). Entries using ProxyJump import as plain hosts with a
  warning (jump chains are out of scope). Conflict strategy: skip existing
  labels, report a summary.
- Export/import shellx config as a JSON bundle: hosts, tunnel rules,
  settings, snippets (when they exist). Passwords/passphrases stay in the
  OS keychain and are explicitly NOT exported; the bundle marks which
  hosts had stored secrets so the importer can prompt.
- Rationale: the first thing a new open-source user does is migrate
  existing hosts — first-impression feature; export doubles as machine
  migration.

### v0.16 — Command snippets

- SQLite `snippets` table: label, body (multi-line), sort order.
- `${placeholder}` variables prompt on send; sends to the active terminal
  session (SSH or local).
- Surfaces: command palette entries and a snippets popover in the terminal
  toolbar; per-snippet "send on connect" flag deferred.

### v0.17 — Serial terminal

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

- Auto-update goes first: no schema risk, and every subsequent release
  reaches users without manual reinstalls — maximum compounding benefit.
- ssh-config import is the open-source first impression and lands before
  the crowd arrives.
- Snippets before serial: serial is the largest single scope (new
  transport + new config surface) and closes the feature tier.

## Out of scope (revisit after v1.0)

- Jump host (ProxyJump) — dropped 2026-08-12: the owner's machines are
  directly reachable; revisit when a layered-network need actually
  appears (design sketch: hosts.jump_host_id FK + direct-tcpip chained
  handshake, one level).
- `-R` remote / `-D` dynamic (SOCKS) forwarding — dropped 2026-08-12: no
  real-world demand in the owner's workflow; the completeness argument
  alone doesn't justify the slot. Revisit if a concrete need appears
  (`-D` first — internal web consoles through a bastion; `-R` shares most
  of the plumbing).
- Multi-session broadcast, Zmodem (rz/sz), session recording/logging,
  SFTP remote-edit-with-local-editor, host groups/folders, settings sync
  over network.
- Session monitor tab — 2026-08-13: a "监控" third tab alongside 终端/文件
  in the SSH session view, showing live CPU / memory / disk / network
  sparklines sampled via SSH (`/proc/stat`, `free`, `/proc/net/dev`) on a
  configurable interval, pushed to the frontend as Tauri events. Only
  visible for SSH sessions (not local/serial). Branch: `feat/session-monitor`.

## Process

Each release follows the standing workflow: feature branch → user visual
verification → explicit 发版 approval → merge to main → bump versions →
release notes (+ README sync when user-visible) → tag → CI installers.
Detailed per-release design happens at cycle start via brainstorming →
spec → implementation plan.

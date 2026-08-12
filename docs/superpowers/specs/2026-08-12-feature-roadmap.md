# shellx Feature Roadmap — v0.14 → v1.0

Status: approved 2026-08-12, revised same day — -R/-D forwarding dropped
from the near-term plan (no real-world demand from the owner's workflow;
deferred until a concrete need appears). One main course per release,
alternating product features with open-source launch infrastructure. Each
release is an independently shippable cycle following the repo's branch →
verify → merge → tag workflow.

## Goals

1. Cover the owner's daily high-frequency needs: jump hosts, command
   snippets, serial debugging.
2. Build the open-source launch foundation in parallel: onboarding
   (ssh-config import), retention (auto-update), trust (signing, docs).

## Release plan

### v0.14 — Jump host (ProxyJump)

- `hosts` gains `jump_host_id` (nullable FK to another saved host).
- Connect chain: connect to the jump host, then open `direct-tcpip` to the
  target and run the SSH handshake through it (russh supports channel
  streams as transport). One jump level in v0.14; chains later if needed.
- UI: Basic tab gains a "Jump host" picker (saved hosts list, none by
  default). Import/export understands `-J user@host[:port]`.
- Cycle detection: a host cannot (transitively) jump through itself.
- Rationale for going first: the only selected capability where absence
  means some machines are unreachable — daily necessity on layered
  corporate networks.

### v0.15 — ssh-config import + config export

- Import `~/.ssh/config`: Host blocks → saved hosts (HostName, User, Port,
  IdentityFile, ProxyJump maps onto v0.14's jump_host_id). Conflict
  strategy: skip existing labels, report a summary.
- Export/import shellx config as a JSON bundle: hosts, tunnel rules,
  settings, snippets (when they exist). Passwords/passphrases stay in the
  OS keychain and are explicitly NOT exported; the bundle marks which
  hosts had stored secrets so the importer can prompt.
- Rationale: the first thing a new open-source user does is migrate
  existing hosts — first-impression feature; export doubles as machine
  migration. Landing right after jump hosts means imported ProxyJump
  entries work immediately.

### v0.16 — Auto-update

- tauri-plugin-updater against GitHub Releases; updater signing keypair
  generated and the public key baked into tauri.conf.json.
- Release workflow uploads `.sig` + `latest.json` artifacts.
- Settings → About: current version, check-for-updates button,
  install-on-restart flow. Opt-out toggle.

### v0.17 — Command snippets

- SQLite `snippets` table: label, body (multi-line), sort order.
- `${placeholder}` variables prompt on send; sends to the active terminal
  session (SSH or local).
- Surfaces: command palette entries and a snippets popover in the terminal
  toolbar; per-snippet "send on connect" flag deferred.

### v0.18 — Serial terminal

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

- Jump host goes first: the only capability whose absence makes machines
  unreachable — connectivity beats convenience.
- ssh-config import follows immediately so imported ProxyJump entries are
  functional on day one; it is also the open-source first impression.
- Auto-update lands after the first user-facing wave (v0.15 brings the
  first migrants) and before the later features, so users stop manually
  reinstalling from v0.16 on.
- Serial closes the feature tier as the largest single scope.

## Out of scope (revisit after v1.0)

- `-R` remote / `-D` dynamic (SOCKS) forwarding — dropped 2026-08-12: no
  real-world demand in the owner's workflow; the completeness argument
  alone doesn't justify the slot. Revisit if a concrete need appears
  (`-D` first — internal web consoles through a bastion; `-R` shares most
  of the plumbing).
- Multi-session broadcast, Zmodem (rz/sz), session recording/logging,
  SFTP remote-edit-with-local-editor, host groups/folders, settings sync
  over network.

## Process

Each release follows the standing workflow: feature branch → user visual
verification → explicit 发版 approval → merge to main → bump versions →
release notes (+ README sync when user-visible) → tag → CI installers.
Detailed per-release design happens at cycle start via brainstorming →
spec → implementation plan.

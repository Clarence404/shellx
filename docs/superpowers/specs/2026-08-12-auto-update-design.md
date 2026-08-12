# v0.14 Auto-Update — Design

Status: approved 2026-08-12 (owner). Roadmap slot: v0.14 (see
`2026-08-12-feature-roadmap.md`).

## Goal

Installed shellx checks GitHub Releases for a newer version on startup,
tells the user unobtrusively, and upgrades in one click — download,
signature verification, install, relaunch.

## UX (agreed)

- **Startup**: silent background check (only when the "auto check" setting
  is on). Failures are logged, never surfaced.
- **Update found**: a small dot on the Settings rail icon + an update
  banner in Settings → About showing the new version. One button —
  "Download & restart" — runs download (with progress) → verify → install
  → relaunch.
- **Manual**: About keeps a "Check for updates" button that works anytime;
  manual-check failures show an inline error (unlike startup).
- **Setting**: About gains an "Automatically check for updates" toggle,
  default ON, persisted in settings.json (`autoUpdateCheck`, serde default
  true so old configs load).
- All copy goes through the i18n dictionary (en/zh).

## Architecture

### Update channel

- Endpoint: `https://github.com/Clarence404/shellx/releases/latest/download/latest.json`
  — the stable "latest release asset" URL; no GitHub API calls, no rate
  limits.
- `tauri.conf.json`: `bundle.createUpdaterArtifacts: true` and a
  `plugins.updater` block with the endpoint and the public key.

### Signing

- One-time: `tauri signer generate` produces the updater keypair.
  - Public key → `tauri.conf.json` (ships with the app).
  - Private key + password → repo Actions secrets
    `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
    (owner adds via GitHub web).
  - The private key MUST be backed up outside the repo: a lost key means
    already-installed builds can never verify a future update.
- Release workflow: pass both secrets as env to tauri-action; with
  `createUpdaterArtifacts` on, it uploads the installers, their `.sig`
  files, and `latest.json` automatically.

### Runtime pieces

- Rust: add `tauri-plugin-updater` and `tauri-plugin-process` (relaunch);
  register both in the builder; grant `updater:default` +
  `process:allow-restart` in capabilities.
- Settings: `auto_update_check: bool` (serde default true) in the Rust
  Settings struct; `autoUpdateCheck` in the TS type/store with a setter.
- Frontend: `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`.
  - A small `src/state/updater.ts` zustand store: `status`
    (`idle | checking | available | downloading | upToDate | error`),
    `available { version, body }`, `progress`, and actions
    `check(silent)` / `downloadAndInstall()`.
  - App startup: if `autoUpdateCheck`, fire `check(silent=true)` once.
  - Rail Settings icon: dot when `status === "available"`.
  - AboutPanel: current version, check button, update banner with
    "Download & restart" and a progress bar during download; toggle for
    auto-check.
- Dev mode: the updater errors without a packaged bundle — `check`
  catches and (in silent mode) swallows; dev behavior unchanged.

## Error handling

- Startup check: any failure → console log only, status back to `idle`.
- Manual check: failure → inline error text in About (i18n).
- Download/install failure: banner switches to error state with retry.
- Signature mismatch is a hard failure by the plugin — surfaced as the
  same error state; never installs unverified bytes.

## Testing & verification

- Unit: settings round-trip for `auto_update_check` (Rust serde default
  test, mirrors `language`); updater store transition tests with the
  plugin API mocked.
- In-app this cycle: manual check reports "up to date" (or a clean error
  in dev), toggle persists across restarts, no startup regressions.
- CI this cycle: the v0.14.0 tag build must upload `.sig` + `latest.json`
  assets alongside installers.
- Full end-to-end (dot → download → relaunch into new version) is only
  provable one release later: install v0.14.0, then ship v0.14.1 and
  observe the upgrade. Tracked as a follow-up verification item, not a
  blocker for this release.

## Out of scope

- Update channels (beta/stable), deltas, background auto-download,
  Linux AppImage self-update edge cases beyond what the plugin provides.

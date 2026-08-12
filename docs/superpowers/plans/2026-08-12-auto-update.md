# v0.14 Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installed shellx silently checks GitHub Releases on startup and upgrades in one click from Settings → About.

**Architecture:** tauri-plugin-updater consumes `latest.json` from the latest GitHub Release; a small zustand store drives check/download state; About panel + rail dot are the only UI surfaces. Updater artifacts are signed in CI with a keypair whose public half ships in tauri.conf.json.

**Tech Stack:** tauri-plugin-updater / tauri-plugin-process (Rust + JS bindings), zustand, existing i18n `useT`.

Spec: `docs/superpowers/specs/2026-08-12-auto-update-design.md`.

## Global Constraints

- Branch: all work on `feat/auto-update` off `main`.
- Commit author is `ChenHan <1154937362@qq.com>` (repo config), no Co-Authored-By.
- Every user-visible string goes through `t()` with a zh entry in `src/i18n/index.ts`.
- `tauri.conf.json` must stay BOM-free (edit with the Edit tool, never PowerShell `Set-Content`).
- Startup check failures are silent (console only); manual check failures show inline.
- Update endpoint (exact): `https://github.com/Clarence404/shellx/releases/latest/download/latest.json`
- Settings field names (exact): Rust `auto_update_check` (serde default true), TS `autoUpdateCheck`.

---

### Task 1: Branch, plugins, capabilities

**Files:**
- Modify: `src-tauri/Cargo.toml` (via cargo add)
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json` (via pnpm add)

**Interfaces:**
- Produces: registered `updater` + `process` plugins; JS packages `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` installed.

- [ ] **Step 1: Create branch**

```bash
git checkout main && git checkout -b feat/auto-update
```

- [ ] **Step 2: Add Rust plugins**

```bash
cd src-tauri && cargo add tauri-plugin-updater tauri-plugin-process
```

- [ ] **Step 3: Register plugins in main.rs**

In `src-tauri/src/main.rs`, directly after `tauri::Builder::default()`:

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

- [ ] **Step 4: Grant capabilities**

In `src-tauri/capabilities/default.json`, append to `permissions`:

```json
    "updater:default",
    "process:default"
```

- [ ] **Step 5: Add JS bindings**

```bash
pnpm add @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

- [ ] **Step 6: Compile check**

Run: `cd src-tauri && cargo check` — expect clean. `pnpm exec tsc --noEmit` — clean.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(updater): register updater + process plugins"
```

### Task 2: Signing key, updater config, workflow env

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `.github/workflows/release.yml`
- Create (outside repo): `~/.tauri/shellx-updater.key` + `.key.pub`

**Interfaces:**
- Produces: public key string in tauri.conf.json; CI signs updater artifacts when the repo secret exists.

- [ ] **Step 1: Generate the keypair (empty password — CI env stays simple)**

```bash
pnpm tauri signer generate -- -w "$HOME/.tauri/shellx-updater.key" --password ""
```

Read the public key from `~/.tauri/shellx-updater.key.pub`.

- [ ] **Step 2: Configure tauri.conf.json (Edit tool only)**

In `bundle`: add `"createUpdaterArtifacts": true`.
Add top-level (or merge into existing) `plugins` block:

```json
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/Clarence404/shellx/releases/latest/download/latest.json"
      ],
      "pubkey": "<contents of shellx-updater.key.pub>"
    }
  }
```

- [ ] **Step 3: Pass signing env in release.yml**

In the `Build + upload to release` step's `env`:

```yaml
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ""
```

- [ ] **Step 4: Verify** — `cd src-tauri && cargo check` (config parse) passes; `pnpm tauri build --help` exits 0 (CLI still healthy).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(updater): updater endpoint + pubkey, CI signing env"
```

**MANUAL GATE (owner, before tagging v0.14.0, not blocking merge):**
add repo secret `TAURI_SIGNING_PRIVATE_KEY` = contents of
`~/.tauri/shellx-updater.key`, and back the key file up outside this
machine. A lost key orphans every installed copy.

### Task 3: `autoUpdateCheck` setting

**Files:**
- Modify: `src-tauri/src/settings/mod.rs`
- Modify: `src/types/settings.ts`, `src/state/settings.ts`
- Test: `src-tauri/src/settings/mod.rs` (inline tests)

**Interfaces:**
- Produces: `useSettingsStore(s => s.autoUpdateCheck)` and `setAutoUpdateCheck(v: boolean)` (immediate save).

- [ ] **Step 1: Write the failing Rust test** (mirror `load_old_settings_without_language_uses_default`)

```rust
    #[test]
    fn load_old_settings_without_auto_update_check_defaults_true() {
        let td = TempDir::new().unwrap();
        let store = SettingsStore::open(td.path());
        let legacy = r#"{"themeId":"warm-minimal","density":"comfortable","systemFont":"system-default","systemFontSize":13,"filesFontSize":13,"terminal":{"fontFamily":"jetbrains-mono","fontSize":13,"cursorStyle":"block"},"schemaVersion":1}"#;
        std::fs::write(td.path().join("settings.json"), legacy).unwrap();
        let got = store.load().unwrap().unwrap();
        assert!(got.auto_update_check);
    }
```

- [ ] **Step 2: Run** `cargo test --lib settings` — FAILS (no field).

- [ ] **Step 3: Add the field**

```rust
    /// Check GitHub Releases for updates on startup. serde default: true.
    #[serde(default = "default_auto_update_check")]
    pub auto_update_check: bool,
```

plus `fn default_auto_update_check() -> bool { true }` and
`auto_update_check: true,` in the test factory `make_settings()`.

- [ ] **Step 4: Run** `cargo test --lib settings` — PASSES (8 tests).

- [ ] **Step 5: TS side** — `src/types/settings.ts`: `autoUpdateCheck: boolean;` in `Settings`, `autoUpdateCheck: true,` in `DEFAULT_SETTINGS`. `src/state/settings.ts`: include in `snapshotForSave`, add

```ts
  setAutoUpdateCheck(v: boolean): void;   // interface
  setAutoUpdateCheck(v) { set({ autoUpdateCheck: v }); immediateSave(get); },
```

- [ ] **Step 6: Verify** `pnpm exec tsc --noEmit` + `pnpm exec vitest run src/state` pass.

- [ ] **Step 7: Commit** `git add -A && git commit -m "feat(updater): autoUpdateCheck setting (default on)"`

### Task 4: Updater store

**Files:**
- Create: `src/state/updater.ts`
- Test: `src/state/updater.test.ts`

**Interfaces:**
- Produces: `useUpdater` zustand store — `status: "idle"|"checking"|"available"|"downloading"|"upToDate"|"error"`, `version`, `notes`, `progress`, `error`, `check(silent: boolean)`, `downloadAndInstall()`.

- [ ] **Step 1: Write failing tests** (`src/state/updater.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCheck = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a: unknown[]) => mockCheck(...a) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { useUpdater } from "./updater";

describe("updater store", () => {
  beforeEach(() => {
    mockCheck.mockReset();
    useUpdater.setState({ status: "idle", version: null, notes: null, progress: 0, error: null });
  });

  it("check → available when an update exists", async () => {
    mockCheck.mockResolvedValue({ version: "9.9.9", body: "notes", downloadAndInstall: vi.fn() });
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().status).toBe("available");
    expect(useUpdater.getState().version).toBe("9.9.9");
  });

  it("check → upToDate when check returns null", async () => {
    mockCheck.mockResolvedValue(null);
    await useUpdater.getState().check(false);
    expect(useUpdater.getState().status).toBe("upToDate");
  });

  it("silent check failure returns to idle without error", async () => {
    mockCheck.mockRejectedValue(new Error("offline"));
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().status).toBe("idle");
    expect(useUpdater.getState().error).toBeNull();
  });

  it("manual check failure surfaces error", async () => {
    mockCheck.mockRejectedValue(new Error("offline"));
    await useUpdater.getState().check(false);
    expect(useUpdater.getState().status).toBe("error");
    expect(useUpdater.getState().error).toContain("offline");
  });
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run src/state/updater.test.ts` — FAILS (module missing).

- [ ] **Step 3: Implement** `src/state/updater.ts`

```ts
import { create } from "zustand";
import { check as updaterCheck, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "upToDate" | "error";

interface UpdaterState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  /** 0..1 while downloading; stays 0 when total size unknown. */
  progress: number;
  error: string | null;
  check(silent: boolean): Promise<void>;
  downloadAndInstall(): Promise<void>;
}

// The Update handle is not serializable state — keep it module-local.
let pending: Update | null = null;

export const useUpdater = create<UpdaterState>((set, get) => ({
  status: "idle", version: null, notes: null, progress: 0, error: null,

  async check(silent) {
    const s = get().status;
    if (s === "checking" || s === "downloading") return;
    set({ status: "checking", error: null });
    try {
      const upd = await updaterCheck();
      if (upd) {
        pending = upd;
        set({ status: "available", version: upd.version, notes: upd.body ?? null });
      } else {
        pending = null;
        set({ status: "upToDate" });
      }
    } catch (e) {
      pending = null;
      if (silent) {
        // Dev builds and offline starts land here — stay quiet.
        console.warn("shellx: update check failed:", e);
        set({ status: "idle" });
      } else {
        set({ status: "error", error: String(e) });
      }
    }
  },

  async downloadAndInstall() {
    if (!pending) return;
    set({ status: "downloading", progress: 0, error: null });
    try {
      let total = 0;
      let received = 0;
      await pending.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          received += ev.data.chunkLength;
          if (total > 0) set({ progress: received / total });
        }
      });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },
}));
```

- [ ] **Step 4: Run** the test file — 4 PASS.

- [ ] **Step 5: Commit** `git add -A && git commit -m "feat(updater): updater store — check / download / relaunch"`

### Task 5: UI wiring — startup check, rail dot, About panel

**Files:**
- Modify: `src/App.tsx` (chain onto the existing settings `load()` call)
- Modify: `src/components/ActivityRail.tsx`
- Modify: `src/components/settings/AboutPanel.tsx`
- Modify: `src/i18n/index.ts`

**Interfaces:**
- Consumes: `useUpdater`, `useSettingsStore.autoUpdateCheck` (Tasks 3-4).

- [ ] **Step 1: Startup check in App.tsx**

Locate the existing `useSettingsStore...load()` effect and chain:

```tsx
      .then(() => {
        if (useSettingsStore.getState().autoUpdateCheck) {
          void useUpdater.getState().check(true);
        }
      })
```

- [ ] **Step 2: Rail dot** — in `ActivityRail.tsx`, subscribe
  `const updateAvailable = useUpdater((s) => s.status === "available");`
  and pass `showDot={item.id === "settings" && updateAvailable}` into
  `RailButton`; render inside the button (icon wrapper gets
  `position: relative`):

```tsx
      {showDot && <span style={{
        position: "absolute", top: -2, right: -4, width: 7, height: 7,
        borderRadius: "50%", background: "var(--error)",
        border: "1.5px solid var(--panel-1)",
      }} />}
```

- [ ] **Step 3: About panel** — add below the version line:
  - update banner when `status === "available"`: accent-bordered box with
    `t("New version available")` + version + "Download & restart" button;
    while `downloading` show `t("Downloading…")` + a thin progress bar
    (`width: ${progress*100}%`); on `error` show the message + `t("Retry")`.
  - a "Check for updates" row: button (disabled while checking, label
    flips to `t("Checking…")`), inline `t("Up to date")` after a manual
    upToDate result, inline error text after a manual failure.
  - the auto-check toggle:

```tsx
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={autoUpdateCheck}
          onChange={(e) => useSettingsStore.getState().setAutoUpdateCheck(e.target.checked)} />
        {t("Automatically check for updates")}
      </label>
```

  - `h3` becomes `{t("About")}`.

- [ ] **Step 4: i18n keys** (zh values):

```ts
  "Check for updates": "检查更新",
  "Checking…": "检查中…",
  "Up to date": "已是最新版本",
  "New version available": "发现新版本",
  "Download & restart": "下载并重启",
  "Downloading…": "下载中…",
  "Update check failed": "检查更新失败",
  "Retry": "重试",
  "Automatically check for updates": "自动检查更新",
```

("About" 关于 already exists.)

- [ ] **Step 5: Verify** `pnpm exec tsc --noEmit` + full `pnpm exec vitest run` — all pass (SettingsView tests still find the About heading via role).

- [ ] **Step 6: Commit** `git add -A && git commit -m "feat(updater): startup check, rail dot, About update banner + toggle"`

### Task 6: Full gate + hand-off

- [ ] **Step 1:** `pnpm exec vitest run` (all), `pnpm exec tsc --noEmit`, `cd src-tauri && cargo test --lib` — all green.
- [ ] **Step 2:** Launch `pnpm tauri:dev` (cmd.exe workaround if needed). In-app checks: About shows the check button; manual check in dev shows the inline error (expected — dev builds have no update bundle); toggle persists after restart; startup logs a silent warn only.
- [ ] **Step 3:** Hand to owner for visual verification. Remind about the MANUAL GATE (repo secret + key backup) before 发版.

## Verification (release-level)

- v0.14.0 CI run must show `.sig` files and `latest.json` among the
  release assets.
- Full upgrade loop is verified at v0.14.1: install v0.14.0, ship
  v0.14.1, watch dot → banner → download → relaunch land on v0.14.1.

import { create } from "zustand";
import { check as updaterCheck, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { logPush } from "../ipc/logs";

// Per-version memory, so one release is announced once: "seen" = the dialog was
// shown and closed (no more auto-opening for it); "ignored" = the user chose
// "Skip this version" (no auto-open and no titlebar button either).
const SEEN_KEY = "shellx.updateNoticeDismissedVersion";
const IGNORED_KEY = "shellx.updateIgnoredVersion";
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* private mode */ }
}

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "upToDate" | "error";

interface UpdaterState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  /** The "what's new" dialog is showing. It opens by itself once per version
   *  when the silent startup check finds one (a manual "Check for updates"
   *  click doesn't — that already put the user in Settings → About), and any
   *  time from the titlebar's Update button. */
  dialogOpen: boolean;
  /** The version the user chose to skip, if any — hides the titlebar button. */
  ignored: string | null;
  /** 0..1 while downloading; stays 0 when total size unknown. */
  progress: number;
  /** Bytes received so far; updated on every Progress event. */
  received: number;
  /** Total bytes; 0 when the server omits Content-Length. */
  total: number;
  error: string | null;
  check(silent: boolean): Promise<void>;
  downloadAndInstall(): Promise<void>;
  openDialog(): void;
  /** Closing counts as having seen this version: it won't pop up again by itself. */
  closeDialog(): void;
  ignoreVersion(): void;
}

// The Update handle is not serializable state — keep it module-local.
let pending: Update | null = null;

export const useUpdater = create<UpdaterState>((set, get) => ({
  status: "idle", version: null, notes: null, dialogOpen: false, ignored: read(IGNORED_KEY),
  progress: 0, received: 0, total: 0, error: null,

  openDialog() { set({ dialogOpen: true }); },
  closeDialog() {
    const v = get().version;
    if (v) write(SEEN_KEY, v);
    set({ dialogOpen: false });
  },
  ignoreVersion() {
    const v = get().version;
    if (v) { write(IGNORED_KEY, v); write(SEEN_KEY, v); }
    set({ dialogOpen: false, ignored: v });
  },

  async check(silent) {
    const s = get().status;
    if (s === "checking" || s === "downloading") return;
    set({ status: "checking", error: null });
    try {
      const upd = await updaterCheck();
      if (upd) {
        pending = upd;
        const announce = silent && read(SEEN_KEY) !== upd.version && read(IGNORED_KEY) !== upd.version;
        set({ status: "available", version: upd.version, notes: upd.body ?? null, dialogOpen: announce });
        void logPush({
          level: "info", category: "updater",
          message: `update available: ${upd.version}`,
          fields: { version: upd.version, silent },
        });
      } else {
        pending = null;
        set({ status: "upToDate" });
        void logPush({
          level: "info", category: "updater",
          message: "no update available, already current",
          fields: { silent },
        });
      }
    } catch (e) {
      pending = null;
      if (silent) {
        // Dev builds and offline starts land here — stay quiet in the UI,
        // but still leave a debug trace in the log stream.
        console.warn("shellx: update check failed:", e);
        set({ status: "idle" });
        void logPush({
          level: "debug", category: "updater",
          message: "silent update check failed",
          fields: { error: String(e) },
        });
      } else {
        set({ status: "error", error: String(e) });
        void logPush({
          level: "error", category: "updater",
          message: "update check failed",
          fields: { error: String(e) },
        });
      }
    }
  },

  async downloadAndInstall() {
    if (!pending) return;
    set({ status: "downloading", progress: 0, received: 0, total: 0, error: null });
    const target = pending.version;
    void logPush({
      level: "info", category: "updater",
      message: `downloading update ${target}`,
      fields: { version: target },
    });
    try {
      let bytesTotal = 0;
      let bytesReceived = 0;
      await pending.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          bytesTotal = ev.data.contentLength ?? 0;
          set({ total: bytesTotal });
        } else if (ev.event === "Progress") {
          bytesReceived += ev.data.chunkLength;
          set({
            received: bytesReceived,
            ...(bytesTotal > 0 ? { progress: bytesReceived / bytesTotal } : {}),
          });
        }
      });
      void logPush({
        level: "info", category: "updater",
        message: `update ${target} installed, relaunching`,
        fields: { version: target, bytes: bytesReceived },
      });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
      void logPush({
        level: "error", category: "updater",
        message: `update ${target} failed to install`,
        fields: { version: target, error: String(e) },
      });
    }
  },
}));

// Dev only: no real release to find, so let the console fake one to look at
// the dialog — `__shellxFakeUpdate()` in the devtools console. Compiled out
// of production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__shellxFakeUpdate = (version = "9.9.9") => {
    useUpdater.setState({
      status: "available", version, dialogOpen: true, ignored: null,
      notes: `# v${version}

A fake release for looking at the update dialog: this is the one-paragraph summary.

- **Something new.** What it does, in a sentence or two.
- **Something fixed.** And what it means for you.
- **A longer one.** Enough text that the notes box has to wrap and, with a few of these, scroll — which is the thing worth checking.

---

> Installers below are unsigned.`,
    });
  };
}

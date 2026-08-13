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

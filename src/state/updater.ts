import { create } from "zustand";
import { check as updaterCheck, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { logPush } from "../ipc/logs";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "upToDate" | "error";

interface UpdaterState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  /** 0..1 while downloading; stays 0 when total size unknown. */
  progress: number;
  /** Bytes received so far; updated on every Progress event. */
  received: number;
  /** Total bytes; 0 when the server omits Content-Length. */
  total: number;
  error: string | null;
  check(silent: boolean): Promise<void>;
  downloadAndInstall(): Promise<void>;
}

// The Update handle is not serializable state — keep it module-local.
let pending: Update | null = null;

export const useUpdater = create<UpdaterState>((set, get) => ({
  status: "idle", version: null, notes: null, progress: 0, received: 0, total: 0, error: null,

  async check(silent) {
    const s = get().status;
    if (s === "checking" || s === "downloading") return;
    set({ status: "checking", error: null });
    try {
      const upd = await updaterCheck();
      if (upd) {
        pending = upd;
        set({ status: "available", version: upd.version, notes: upd.body ?? null });
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

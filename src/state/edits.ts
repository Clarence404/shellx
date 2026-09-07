import { create } from "zustand";
import * as ipc from "../ipc/edit";
import type { EditInfo } from "../ipc/edit";
import { useSettingsStore } from "./settings";

const NOTICE_KEY = "shellx.remoteEditNoticeSeen";
function noticeSeen(): boolean {
  try { return localStorage.getItem(NOTICE_KEY) === "1"; } catch { return false; }
}
function markNoticeSeen() {
  try { localStorage.setItem(NOTICE_KEY, "1"); } catch { /* private mode */ }
}

export interface EditEntry extends EditInfo {
  /** Unix millis of the last successful upload, if any. */
  lastUploadAt?: number;
  /** Last upload error message, if the most recent save failed. */
  error?: string;
}

interface EditsState {
  edits: EditEntry[];
  /** A pending open awaiting the first-time notice. null once dismissed. */
  pending: { connId: string; remotePath: string; name: string } | null;

  /** Entry point from the file row. Shows the one-time notice the first
   *  time, otherwise opens straight away. */
  requestOpen: (connId: string, remotePath: string) => void;
  confirmPending: (dontShowAgain: boolean) => void;
  cancelPending: () => void;

  markUploaded: (id: string, at: number) => void;
  markFailed: (id: string, error: string) => void;
  /** Stop watching a single edit (backend removes the temp copy). */
  stop: (id: string) => void;
  /** Stop every watch belonging to a session — called when it disconnects
   *  or its tab closes, so watches don't linger and retry against a dead
   *  connection. */
  stopForConn: (connId: string) => void;
}

function basename(p: string): string {
  return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;
}

async function doOpen(connId: string, remotePath: string) {
  const editor = useSettingsStore.getState().externalEditor;
  try {
    const info = await ipc.editOpen(connId, remotePath, editor);
    useEditsStore.setState((s) => ({ edits: [...s.edits.filter((x) => x.id !== info.id), { ...info }] }));
  } catch {
    // download / launch failure — nothing to add; the file row simply
    // won't appear in the watching list.
  }
}

export const useEditsStore = create<EditsState>((set) => ({
  edits: [],
  pending: null,

  requestOpen: (connId, remotePath) => {
    if (noticeSeen()) { void doOpen(connId, remotePath); return; }
    set({ pending: { connId, remotePath, name: basename(remotePath) } });
  },
  confirmPending: (dontShowAgain) => {
    const p = useEditsStore.getState().pending;
    set({ pending: null });
    if (dontShowAgain) markNoticeSeen();
    if (p) void doOpen(p.connId, p.remotePath);
  },
  cancelPending: () => set({ pending: null }),

  markUploaded: (id, at) =>
    set((s) => ({ edits: s.edits.map((e) => (e.id === id ? { ...e, lastUploadAt: at, error: undefined } : e)) })),
  markFailed: (id, error) =>
    set((s) => ({ edits: s.edits.map((e) => (e.id === id ? { ...e, error } : e)) })),
  stop: (id) => {
    void ipc.editStop(id);
    set((s) => ({ edits: s.edits.filter((e) => e.id !== id) }));
  },
  stopForConn: (connId) => {
    set((s) => {
      const gone = s.edits.filter((e) => e.connId === connId);
      gone.forEach((e) => void ipc.editStop(e.id));
      if (gone.length === 0) return s;
      return { edits: s.edits.filter((e) => e.connId !== connId) };
    });
  },
}));

let wired = false;
/** Wire backend edit events into the store once, at app start. */
export function installEditStream() {
  if (wired) return;
  wired = true;
  void ipc.onEditUploaded(({ id, at }) => useEditsStore.getState().markUploaded(id, at));
  void ipc.onEditFailed(({ id, error }) => useEditsStore.getState().markFailed(id, error));
}

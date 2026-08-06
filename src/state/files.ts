import { create } from "zustand";
import * as ipc from "../ipc/sftp";
import type { SftpEntry } from "../types/sftp";

interface PerConnectionState {
  cwd: string;
  entries: SftpEntry[];
  loading: boolean;
  error: string | null;
  selectedNames: string[];
}

interface FilesStore {
  perConnection: Record<string, PerConnectionState>;
  loadDir: (connId: string, path: string) => Promise<void>;
  select: (connId: string, name: string, multi: boolean) => void;
  clearSelection: (connId: string) => void;
  clear: (connId: string) => void;
}

export const useFilesStore = create<FilesStore>((set, get) => ({
  perConnection: {},

  loadDir: async (connId, path) => {
    set((st) => ({
      perConnection: {
        ...st.perConnection,
        [connId]: { ...(st.perConnection[connId] ?? {}), cwd: path, loading: true, error: null, entries: [], selectedNames: [] },
      },
    }));

    // v0.5.7: soft-retry on "closed" — the freshly-connected session's
    // SFTP subchannel can transiently report closed before the russh
    // handshake fully completes (same race as useRailFiles.setRightHost
    // handled). Retry once after a short delay before surfacing an
    // error to the pane. Any other error class errors out immediately.
    const attemptList = async (): Promise<{ ok: true; entries: SftpEntry[] } | { ok: false; error: string }> => {
      try { return { ok: true, entries: await ipc.sftpListDir(connId, path) }; }
      catch (e) { return { ok: false, error: String(e) }; }
    };

    let result = await attemptList();
    if (!result.ok && /closed/i.test(result.error)) {
      await new Promise((r) => setTimeout(r, 250));
      result = await attemptList();
    }

    if (result.ok) {
      set((st) => ({
        perConnection: {
          ...st.perConnection,
          [connId]: { cwd: path, entries: result.entries, loading: false, error: null, selectedNames: [] },
        },
      }));
    } else {
      set((st) => ({
        perConnection: {
          ...st.perConnection,
          [connId]: { ...(st.perConnection[connId] ?? { cwd: path, entries: [], selectedNames: [] }), loading: false, error: result.error },
        },
      }));
    }
  },

  select: (connId, name, multi) => set((st) => {
    const cur = st.perConnection[connId];
    if (!cur) return {};
    const already = cur.selectedNames.includes(name);
    let next: string[];
    if (multi) next = already ? cur.selectedNames.filter(n => n !== name) : [...cur.selectedNames, name];
    else next = already && cur.selectedNames.length === 1 ? [] : [name];
    return { perConnection: { ...st.perConnection, [connId]: { ...cur, selectedNames: next } } };
  }),

  clearSelection: (connId) => set((st) => {
    const cur = st.perConnection[connId];
    if (!cur) return {};
    return { perConnection: { ...st.perConnection, [connId]: { ...cur, selectedNames: [] } } };
  }),

  clear: (connId) => set((st) => {
    const { [connId]: _, ...rest } = st.perConnection;
    return { perConnection: rest };
  }),
}));

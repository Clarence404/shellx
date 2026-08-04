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
    try {
      const entries = await ipc.sftpListDir(connId, path);
      set((st) => ({
        perConnection: {
          ...st.perConnection,
          [connId]: { cwd: path, entries, loading: false, error: null, selectedNames: [] },
        },
      }));
    } catch (e) {
      set((st) => ({
        perConnection: {
          ...st.perConnection,
          [connId]: { ...(st.perConnection[connId] ?? { cwd: path, entries: [], selectedNames: [] }), loading: false, error: String(e) },
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

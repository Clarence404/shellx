import { create } from "zustand";
import * as ipc from "../ipc/serial";
import type { SerialPortInfo, SerialProfile } from "../types/serial";

interface SerialStore {
  profiles: SerialProfile[];
  ports: SerialPortInfo[];
  loaded: boolean;
  /** session id → port name, written at connect time. Liveness is decided
      by joining against the sessions store, so no teardown bookkeeping —
      stale entries for closed sessions are simply never matched. */
  openBySession: Record<string, string>;

  load: () => Promise<void>;
  refreshPorts: () => Promise<void>;
  add: (p: ipc.NewSerialProfile) => Promise<SerialProfile>;
  update: (id: string, patch: Partial<ipc.NewSerialProfile>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  noteSession: (sessionId: string, port: string) => void;
}

export const useSerialStore = create<SerialStore>((set) => ({
  profiles: [],
  ports: [],
  loaded: false,
  openBySession: {},

  load: async () => {
    const [profiles, ports] = await Promise.all([
      ipc.serialProfileList(),
      ipc.serialListPorts(),
    ]);
    set({ profiles, ports, loaded: true });
  },

  refreshPorts: async () => {
    const ports = await ipc.serialListPorts();
    set({ ports });
  },

  add: async (p) => {
    const created = await ipc.serialProfileSave(p);
    set((st) => ({ profiles: [...st.profiles, created] }));
    return created;
  },

  update: async (id, patch) => {
    const updated = await ipc.serialProfileUpdate(id, patch);
    set((st) => ({
      profiles: st.profiles.map((p) => (p.id === id ? updated : p)),
    }));
  },

  remove: async (id) => {
    await ipc.serialProfileDelete(id);
    set((st) => ({ profiles: st.profiles.filter((p) => p.id !== id) }));
  },

  noteSession: (sessionId, port) => {
    set((st) => ({ openBySession: { ...st.openBySession, [sessionId]: port } }));
  },
}));

let loadedOnce = false;
export function loadSerialOnce() {
  if (loadedOnce) return;
  loadedOnce = true;
  void useSerialStore.getState().load();
}

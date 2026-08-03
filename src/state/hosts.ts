import { create } from "zustand";
import type { HostInfo, SaveHostArgs, UpdateHostArgs } from "../types/host";
import * as ipc from "../ipc/hosts";

interface HostsState {
  hosts: HostInfo[];
  keychainAvailable: boolean;
  loaded: boolean;

  load: () => Promise<void>;
  addHost: (args: SaveHostArgs) => Promise<HostInfo>;
  updateHostById: (args: UpdateHostArgs) => Promise<HostInfo>;
  deleteHostById: (id: string) => Promise<void>;
  setKeychainAvailable: (b: boolean) => void;
}

export const useHostsStore = create<HostsState>((set) => ({
  hosts: [],
  keychainAvailable: false,
  loaded: false,

  load: async () => {
    const [hosts, keychainAvailable] = await Promise.all([
      ipc.listHosts(),
      ipc.keychainAvailable(),
    ]);
    set({ hosts, keychainAvailable, loaded: true });
  },

  addHost: async (args) => {
    const inserted = await ipc.saveHost(args);
    set((st) => ({ hosts: [...st.hosts, inserted] }));
    return inserted;
  },

  updateHostById: async (args) => {
    const updated = await ipc.updateHost(args);
    set((st) => ({
      hosts: st.hosts.map((h) => (h.id === updated.id ? updated : h)),
    }));
    return updated;
  },

  deleteHostById: async (id) => {
    await ipc.deleteHost(id);
    set((st) => ({ hosts: st.hosts.filter((h) => h.id !== id) }));
  },

  setKeychainAvailable: (b) => set({ keychainAvailable: b }),
}));

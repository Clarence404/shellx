import { create } from "zustand";
import type { HostInfo, HostSaveResult, SaveHostArgs, UpdateHostArgs } from "../types/host";
import * as ipc from "../ipc/hosts";

interface HostsState {
  hosts: HostInfo[];
  keychainAvailable: boolean;
  loaded: boolean;

  load: () => Promise<void>;
  addHost: (args: SaveHostArgs) => Promise<HostSaveResult>;
  updateHostById: (args: UpdateHostArgs) => Promise<HostSaveResult>;
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
    const result = await ipc.saveHost(args);
    const { password_stored, ...host } = result;
    set((st) => ({ hosts: [...st.hosts, host] }));
    return result;
  },

  updateHostById: async (args) => {
    const result = await ipc.updateHost(args);
    const { password_stored, ...host } = result;
    set((st) => ({
      hosts: st.hosts.map((h) => (h.id === host.id ? host : h)),
    }));
    return result;
  },

  deleteHostById: async (id) => {
    await ipc.deleteHost(id);
    set((st) => ({ hosts: st.hosts.filter((h) => h.id !== id) }));
  },

  setKeychainAvailable: (b) => set({ keychainAvailable: b }),
}));

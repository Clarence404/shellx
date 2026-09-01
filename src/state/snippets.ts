import { create } from "zustand";
import * as ipc from "../ipc/snippets";
import type { NewSnippet, Snippet } from "../types/snippets";

interface SnippetsStore {
  list: Snippet[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (s: NewSnippet) => Promise<Snippet>;
  update: (id: string, update: Partial<NewSnippet>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useSnippetsStore = create<SnippetsStore>((set, get) => ({
  list: [],
  loaded: false,

  load: async () => {
    const list = await ipc.snippetList();
    set({ list, loaded: true });
  },

  add: async (s) => {
    const created = await ipc.snippetSave(s);
    set((st) => ({ list: [...st.list, created] }));
    return created;
  },

  update: async (id, update) => {
    await ipc.snippetUpdate(id, update);
    set((st) => ({
      list: st.list.map((s) => (s.id === id ? { ...s, ...update } : s)),
    }));
  },

  remove: async (id) => {
    await ipc.snippetDelete(id);
    set((st) => ({ list: st.list.filter((s) => s.id !== id) }));
  },
}));

export type { Snippet };
export const loadSnippetsOnce = () => {
  const st = useSnippetsStore.getState();
  if (!st.loaded) void st.load();
};

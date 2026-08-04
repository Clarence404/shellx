import { create } from "zustand";
import * as ipc from "../ipc/transfers";
import type { TransferProgressEvent, TransferDoneEvent } from "../ipc/transfers";
import type { TransferInfo } from "../types/sftp";

const REMOVE_AFTER_DONE_MS = 5000;

interface TransfersStore {
  list: TransferInfo[];
  loading: boolean;

  loadInitial: () => Promise<void>;
  applyStarted: (info: TransferInfo) => void;
  applyProgress: (e: TransferProgressEvent) => void;
  applyDone: (e: TransferDoneEvent) => void;
  cancel: (transferId: string) => Promise<void>;
  remove: (transferId: string) => void;
}

export const useTransfersStore = create<TransfersStore>((set, get) => ({
  list: [],
  loading: false,

  loadInitial: async () => {
    set({ loading: true });
    const list = await ipc.transferList();
    set({ list, loading: false });
  },

  // Inserts a `Queued`-state stub for an id the store hasn't seen yet, fired
  // by `transfer:started` (see ipc/transfers.ts). Guards against duplicate
  // inserts since `App.tsx`'s listener registration can theoretically race
  // `loadInitial()`'s own fetch for a transfer that started just before
  // mount.
  applyStarted: (info) =>
    set((st) => {
      if (st.list.some((t) => t.id === info.id)) return st;
      return { list: [...st.list, info] };
    }),

  applyProgress: (e) =>
    set((st) => ({
      list: st.list.map((t) =>
        t.id === e.transfer_id
          ? { ...t, bytes_done: e.bytes_done, total_bytes: e.total_bytes }
          : t
      ),
    })),

  applyDone: (e) => {
    set((st) => ({
      list: st.list.map((t) => (t.id === e.transfer_id ? { ...t, state: e.state } : t)),
    }));
    setTimeout(() => get().remove(e.transfer_id), REMOVE_AFTER_DONE_MS);
  },

  cancel: (transferId) => ipc.transferCancel(transferId),

  remove: (transferId) =>
    set((st) => ({ list: st.list.filter((t) => t.id !== transferId) })),
}));

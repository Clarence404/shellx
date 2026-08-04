import { create } from "zustand";
import * as ipc from "../ipc/transfers";
import type { TransferProgressEvent, TransferDoneEvent } from "../ipc/transfers";
import type { TransferInfo } from "../types/sftp";

const REMOVE_AFTER_DONE_MS = 5000;

interface TransfersStore {
  list: TransferInfo[];
  loading: boolean;

  loadInitial: () => Promise<void>;
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

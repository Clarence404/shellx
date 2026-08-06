import { create } from "zustand";
import * as ipc from "../ipc/transfers";
import type { TransferProgressEvent, TransferDoneEvent, TransferStateEvent } from "../ipc/transfers";
import type { TransferInfo } from "../types/sftp";

const REMOVE_AFTER_DONE_MS = 5000;

interface TransfersStore {
  list: TransferInfo[];
  loading: boolean;

  loadInitial: () => Promise<void>;
  applyStarted: (info: TransferInfo) => void;
  applyProgress: (e: TransferProgressEvent) => void;
  applyState: (e: TransferStateEvent) => void;
  applyDone: (e: TransferDoneEvent) => void;
  cancel: (transferId: string) => Promise<void>;
  pause: (transferId: string) => Promise<void>;
  resume: (transferId: string) => Promise<void>;
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
      list: st.list.map((t) => {
        if (t.id !== e.transfer_id) return t;
        // Any progress tick implies the byte-pumping loop is running —
        // promote to "active" if we're still showing "queued". Rust's
        // `mark_active` only mutates the in-memory info map; it doesn't
        // emit a state-change event, so without this the frontend
        // would show "queued" for the entire transfer.
        const promoted = t.state.kind === "queued" ? { kind: "active" as const } : t.state;
        return { ...t, bytes_done: e.bytes_done, total_bytes: e.total_bytes, state: promoted };
      }),
    })),

  applyDone: (e) => {
    set((st) => ({
      list: st.list.map((t) => (t.id === e.transfer_id ? { ...t, state: e.state } : t)),
    }));
    // v0.6 T1: only auto-remove standalone transfers. Group children
    // linger so the bottom-bar aggregate keeps showing correct file
    // counts as siblings finish; T3 introduces a Transfers view + a
    // Clear finished action that owns group cleanup end-to-end.
    const t = get().list.find((x) => x.id === e.transfer_id);
    if (!t?.groupId) {
      setTimeout(() => get().remove(e.transfer_id), REMOVE_AFTER_DONE_MS);
    }
  },

  applyState: (e) =>
    set((st) => ({
      list: st.list.map((t) =>
        t.id === e.transfer_id ? { ...t, state: e.state } : t,
      ),
    })),

  cancel: (transferId) => ipc.transferCancel(transferId),
  pause: (transferId) => ipc.transferPause(transferId),
  resume: (transferId) => ipc.transferResume(transferId),

  remove: (transferId) =>
    set((st) => ({ list: st.list.filter((t) => t.id !== transferId) })),
}));

import { create } from "zustand";
import * as ipc from "../ipc/transfers";
import type { TransferProgressEvent, TransferDoneEvent, TransferStateEvent } from "../ipc/transfers";
import type { TransferInfo } from "../types/sftp";

const REMOVE_AFTER_DONE_MS = 5000;

interface TransfersStore {
  list: TransferInfo[];
  loading: boolean;
  /** Group ids the user has cancelled locally. Kept as a Set so
   *  `applyStarted` can drop any late-arriving `transfer:started`
   *  events whose Rust-side spawn had already been dispatched by the
   *  time the cancel was clicked — otherwise a 2 500-file directory
   *  cancel would keep bumping the group's "totalFiles" counter for
   *  another second while the in-flight spawn IPCs finished landing. */
  cancelledGroupIds: Set<string>;

  loadInitial: () => Promise<void>;
  applyStarted: (info: TransferInfo) => void;
  applyProgress: (e: TransferProgressEvent) => void;
  applyState: (e: TransferStateEvent) => void;
  applyDone: (e: TransferDoneEvent) => void;
  cancel: (transferId: string) => Promise<void>;
  cancelGroup: (groupId: string) => Promise<void>;
  pause: (transferId: string) => Promise<void>;
  resume: (transferId: string) => Promise<void>;
  remove: (transferId: string) => void;
}

export const useTransfersStore = create<TransfersStore>((set, get) => ({
  list: [],
  loading: false,
  cancelledGroupIds: new Set<string>(),

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
      // Late `transfer:started` for an already-cancelled group: Rust's
      // sftp_upload_dir loop had already spawned this child before it
      // reached the `is_group_cancelled` check. Drop the event so the
      // group's file count stops climbing after the user clicks ✕.
      if (info.groupId && st.cancelledGroupIds.has(info.groupId)) return st;
      return { list: [...st.list, info] };
    }),

  applyProgress: (e) =>
    set((st) => ({
      list: st.list.map((t) => {
        if (t.id !== e.transfer_id) return t;
        // A pending pause / cancel that hasn't caught up on the Rust
        // side yet still emits a couple of trailing progress ticks
        // (the byte-pump loop finishes its current chunk before
        // observing the flag). Suppressing bytes updates while the
        // frontend already shows "paused" or "cancelled" keeps the
        // visual response instant — the bar freezes the moment the
        // user clicks the button.
        if (t.state.kind === "paused" || t.state.kind === "cancelled") return t;
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

  // Optimistic UI: mark the target state locally before the Rust
  // task has actually observed the signal. The byte-pump loop's
  // chunk-boundary polling (and, for a stalled network, russh-sftp's
  // internal write queue) can take up to a few hundred ms to catch
  // up; without an optimistic flip the pause / cancel button felt
  // like it did nothing for that window. `applyProgress` also
  // suppresses byte updates in these terminal-ish states so the
  // progress bar freezes instantly.
  cancel: (transferId) => {
    set((st) => ({
      list: st.list.map((t) =>
        t.id === transferId ? { ...t, state: { kind: "cancelled" as const } } : t,
      ),
    }));
    return ipc.transferCancel(transferId);
  },
  cancelGroup: (groupId) => {
    set((st) => {
      const next = new Set(st.cancelledGroupIds);
      next.add(groupId);
      return {
        list: st.list.map((t) =>
          t.groupId === groupId ? { ...t, state: { kind: "cancelled" as const } } : t,
        ),
        cancelledGroupIds: next,
      };
    });
    return ipc.transferCancelGroup(groupId);
  },
  pause: (transferId) => {
    set((st) => ({
      list: st.list.map((t) =>
        t.id === transferId ? { ...t, state: { kind: "paused" as const } } : t,
      ),
    }));
    return ipc.transferPause(transferId);
  },
  resume: (transferId) => {
    set((st) => ({
      list: st.list.map((t) =>
        t.id === transferId ? { ...t, state: { kind: "active" as const } } : t,
      ),
    }));
    return ipc.transferResume(transferId);
  },

  remove: (transferId) =>
    set((st) => ({ list: st.list.filter((t) => t.id !== transferId) })),
}));

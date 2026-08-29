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
  retry: (transferId: string) => Promise<void>;
  /** Bulk operations: one optimistic list pass + one IPC call, never
   *  one per file. `connId` scopes to a connection; absent = all. */
  pauseAll: (connId?: string) => Promise<void>;
  resumeAll: (connId?: string) => Promise<void>;
  cancelAll: (connId?: string) => Promise<void>;
  /** Gesture-scoped variants — the strip's per-row buttons. Same shape:
   *  one optimistic pass, one IPC call. */
  pauseGroup: (groupId: string) => Promise<void>;
  resumeGroup: (groupId: string) => Promise<void>;
  retryGroup: (groupId: string) => Promise<void>;
  removeGroup: (groupId: string) => void;
}

// Flush cadence for the two high-volume events. 100ms keeps the UI at
// ten updates a second however many files are moving.
const STARTED_FLUSH_MS = 100;
let startedBuffer: TransferInfo[] = [];
let startedTimer: ReturnType<typeof setTimeout> | null = null;
let doneBuffer: TransferDoneEvent[] = [];
let doneTimer: ReturnType<typeof setTimeout> | null = null;

export const useTransfersStore = create<TransfersStore>((set, get) => ({
  list: [],
  loading: false,
  cancelledGroupIds: new Set<string>(),

  loadInitial: async () => {
    set({ loading: true });
    const list = await ipc.transferList();
    set({ list, loading: false });
  },

  // The two high-volume events are buffered and flushed on a short
  // timer: enumerating a 20 000-file directory fires one started event
  // per file, and cancelling it fires one done event per file. One
  // store update per event is a full re-render per event over an
  // ever-growing list — the UI froze exactly when the user most needed
  // the cancel button to work.
  // Inserts a `Queued`-state stub for an id the store hasn't seen yet, fired
  // by `transfer:started` (see ipc/transfers.ts). Guards against duplicate
  // inserts since `App.tsx`'s listener registration can theoretically race
  // `loadInitial()`'s own fetch for a transfer that started just before
  // mount.
  applyStarted: (info) => {
    startedBuffer.push(info);
    if (startedTimer === null) {
      startedTimer = setTimeout(() => {
        const batch = startedBuffer;
        startedBuffer = [];
        startedTimer = null;
        set((st) => {
          const seen = new Set(st.list.map((t) => t.id));
          const fresh = batch.filter((i) => {
            if (seen.has(i.id)) return false;
            // Late `transfer:started` for an already-cancelled group:
            // Rust's enumeration loop had already spawned this child
            // before it reached the is_group_cancelled check. Drop it so
            // the file count stops climbing after the cancel click.
            if (i.groupId && st.cancelledGroupIds.has(i.groupId)) return false;
            seen.add(i.id);
            return true;
          });
          return fresh.length ? { list: [...st.list, ...fresh] } : st;
        });
      }, STARTED_FLUSH_MS);
    }
  },

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
        return {
          ...t,
          bytes_done: e.bytes_done,
          total_bytes: e.total_bytes,
          rateBps: e.rate_bps,
          state: promoted,
        };
      }),
    })),

  applyDone: (e) => {
    doneBuffer.push(e);
    if (doneTimer === null) {
      doneTimer = setTimeout(() => {
        const batch = doneBuffer;
        doneBuffer = [];
        doneTimer = null;
        const byId = new Map(batch.map((ev) => [ev.transfer_id, ev.state]));
        set((st) => ({
          list: st.list.map((t) => {
            const next = byId.get(t.id);
            return next ? { ...t, state: next } : t;
          }),
        }));
      }, STARTED_FLUSH_MS);
    }
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

  remove: (transferId) => {
    set((st) => ({ list: st.list.filter((t) => t.id !== transferId) }));
    // Also forget it on the Rust side, or the next list load would
    // resurrect the row that was just dismissed. Best-effort: a transfer
    // Rust already dropped is fine.
    void ipc.transferRemove(transferId).catch(() => {});
  },

  pauseAll: async (connId) => {
    set((st) => ({
      list: st.list.map((t) =>
        (connId === undefined || t.connection_id === connId)
        && (t.state.kind === "queued" || t.state.kind === "active")
          ? { ...t, state: { kind: "paused" as const } }
          : t,
      ),
    }));
    await ipc.transferPauseAll(connId);
  },

  resumeAll: async (connId) => {
    set((st) => ({
      list: st.list.map((t) =>
        (connId === undefined || t.connection_id === connId) && t.state.kind === "paused"
          ? { ...t, state: { kind: "active" as const } }
          : t,
      ),
    }));
    await ipc.transferResumeAll(connId);
  },

  cancelAll: async (connId) => {
    set((st) => {
      const groups = new Set(st.cancelledGroupIds);
      for (const t of st.list) {
        if ((connId === undefined || t.connection_id === connId) && t.groupId) {
          groups.add(t.groupId);
        }
      }
      return {
        list: st.list.map((t) =>
          (connId === undefined || t.connection_id === connId)
          && (t.state.kind === "queued" || t.state.kind === "active" || t.state.kind === "paused")
            ? { ...t, state: { kind: "cancelled" as const } }
            : t,
        ),
        cancelledGroupIds: groups,
      };
    });
    await ipc.transferCancelAll(connId);
  },

  pauseGroup: async (groupId) => {
    set((st) => ({
      list: st.list.map((t) =>
        t.groupId === groupId && (t.state.kind === "queued" || t.state.kind === "active")
          ? { ...t, state: { kind: "paused" as const } }
          : t,
      ),
    }));
    await ipc.transferPauseAll(undefined, groupId);
  },

  resumeGroup: async (groupId) => {
    set((st) => ({
      list: st.list.map((t) =>
        t.groupId === groupId && t.state.kind === "paused"
          ? { ...t, state: { kind: "active" as const } }
          : t,
      ),
    }));
    await ipc.transferResumeAll(undefined, groupId);
  },

  retryGroup: async (groupId) => {
    // Failed members leave optimistically; the retried transfers come
    // back through ordinary transfer:started events with fresh ids.
    set((st) => ({
      list: st.list.filter((t) => !(t.groupId === groupId && t.state.kind === "failed")),
    }));
    try {
      await ipc.transferRetryGroup(groupId);
    } catch {
      await get().loadInitial();
    }
  },

  removeGroup: (groupId) => {
    set((st) => ({
      list: st.list.filter((t) => {
        if (t.groupId !== groupId) return true;
        const k = t.state.kind;
        return k === "queued" || k === "active" || k === "paused";
      }),
    }));
    void ipc.transferRemoveGroup(groupId).catch(() => {});
  },

  retry: async (transferId) => {
    // Drop the failed row optimistically; the retried transfer arrives
    // through the ordinary transfer:started event with a fresh id.
    set((st) => ({ list: st.list.filter((t) => t.id !== transferId) }));
    try {
      await ipc.transferRetry(transferId);
    } catch {
      // The retry could not even be queued (row gone, host deleted) —
      // reload the truth rather than guessing at local state.
      await get().loadInitial();
    }
  },
}));

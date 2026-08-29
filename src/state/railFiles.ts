import { create } from "zustand";
import type { LocalEntry } from "../types/local";
import type { SftpEntry } from "../types/sftp";
import type { ConnectionId } from "../types/connection";
import { localListDir, localRealpath } from "../ipc/local";
import { sftpListDir, sftpRealpath } from "../ipc/sftp";
import { sftpUpload, sftpDownload, newGesture } from "../ipc/transfers";
import { useSessions } from "./sessions";

interface State {
  leftPath: string;
  leftEntries: LocalEntry[];
  leftLoading: boolean;
  leftError: string | null;
  leftSelected: string[];

  rightHost: ConnectionId | null;
  /** Saved-host id captured at the moment `setRightHost` was called with
   * a valid session. Survives session close/remove so RemotePane can
   * still show the host label + offer Reconnect in the DisconnectedPanel
   * even after the closed session is purged from `useSessions.sessions`.
   * Null for quick-connect sessions (no matching saved host row). */
  rightSavedHostId: string | null;
  rightPath: string;
  rightEntries: SftpEntry[];
  rightLoading: boolean;
  rightError: string | null;
  rightSelected: string[];

  splitterPercent: number;
  /** Bottom transfer strip's height in pixels — the value used
   *  whenever ANY group is expanded. Collapsed state (no group open)
   *  ignores this and pins the strip to a compact header-only height.
   *  Persisted so the user's dragged size survives restart. */
  transferStripHeight: number;
  /** Per-group expand flag for the bottom transfer strip. Not
   *  persisted — session-scoped. TransferQueue reads / writes it via
   *  `setTransferGroupExpanded`; RailFilesView subscribes to derive
   *  the effective strip height + divider visibility. */
  /** The strip's expanded/collapsed state — one flag shared by every
   *  surface that renders the strip, so opening it in one view means it
   *  is open in the others too. Session-scoped, not persisted. */
  transfersExpanded: boolean;

  /** v0.5.7: transient state describing the file currently being
   *  drag-dropped between panes. Set on mousedown-then-move-past-
   *  threshold in each FileRow's wrapper, cleared on mouseup. Includes
   *  the current cursor position so RailFilesView can render a
   *  floating drag-ghost that follows the pointer, and `hoverTarget`
   *  (the pane the cursor is currently over — null when over neither)
   *  so the destination pane can highlight itself while the source
   *  pane doesn't. Mouse-based drag replaced HTML5 drag entirely
   *  because WebView2 + Tauri's `dragDropEnabled: true` suppresses
   *  internal HTML5 drop events unreliably; pointer events are
   *  Chromium primitives that Tauri can't intercept. */
  currentDrag: {
    pane: "left" | "right";
    name: string;
    /** v0.6 T1: distinguishes file vs directory drag so the drop
     *  handler can route to `sftpUploadDir` / `sftpDownloadDir` for
     *  folders instead of the single-file IPCs. */
    kind: "file" | "directory";
    x: number;
    y: number;
    hoverTarget: "left" | "right" | null;
  } | null;
}

interface Actions {
  setLeftPath(p: string): Promise<void>;
  setRightHost(id: ConnectionId | null): Promise<void>;
  setRightPath(p: string): Promise<void>;
  loadLeft(): Promise<void>;
  loadRight(): Promise<void>;
  toggleSelectLeft(name: string, multi: boolean): void;
  toggleSelectRight(name: string, multi: boolean): void;
  setCurrentDrag(d: State["currentDrag"]): void;
  clearSelectionLeft(): void;
  clearSelectionRight(): void;
  transfer(direction: "up" | "down"): void;
  setSplitterDraft(pct: number): void;
  setSplitter(pct: number): void;
  setTransferStripHeightDraft(px: number): void;
  setTransferStripHeight(px: number): void;
  toggleTransfersExpanded(): void;
}

// Bounds for the bottom transfer strip's height. `80` keeps the group
// summary row + a splash of scroll always visible; `70vh` (resolved at
// use-time) keeps at least a bit of file browser on screen.
const TRANSFER_STRIP_MIN_PX = 80;
const TRANSFER_STRIP_DEFAULT_PX = 220;
function clampTransferStripPx(px: number): number {
  // 40% of the window, down from 70%: the strip is a status area, and
  // the file panes are the point of the view. Guarded because this now
  // also runs at module load (re-clamping the persisted height), where
  // a windowless test environment has no innerHeight.
  const viewport = typeof window === "undefined" ? 800 : window.innerHeight;
  const max = Math.max(TRANSFER_STRIP_MIN_PX + 40, Math.round(viewport * 0.4));
  return Math.max(TRANSFER_STRIP_MIN_PX, Math.min(max, Math.round(px)));
}

const LS = "railFiles";
function loadPersisted(): Partial<State> {
  try {
    const raw = localStorage.getItem(LS);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function persist(st: State) {
  const pick = {
    leftPath: st.leftPath,
    rightHost: st.rightHost,
    rightSavedHostId: st.rightSavedHostId,
    // per-host rightPath map: pull existing map from storage, patch our current host
    rightPaths: (() => {
      try {
        const raw = JSON.parse(localStorage.getItem(LS) || "{}");
        const map = raw.rightPaths || {};
        if (st.rightHost) map[st.rightHost] = st.rightPath;
        return map;
      } catch { return st.rightHost ? { [st.rightHost]: st.rightPath } : {}; }
    })(),
    splitterPercent: st.splitterPercent,
    transferStripHeight: st.transferStripHeight,
  };
  localStorage.setItem(LS, JSON.stringify(pick));
}

const persisted = loadPersisted() as any;

export const useRailFiles = create<State & Actions>((set, get) => ({
  leftPath: persisted.leftPath ?? "",
  leftEntries: [], leftLoading: false, leftError: null, leftSelected: [],

  rightHost: persisted.rightHost ?? null,
  rightSavedHostId: persisted.rightSavedHostId ?? null,
  rightPath: persisted.rightHost ? (persisted.rightPaths?.[persisted.rightHost] ?? "") : "",
  rightEntries: [], rightLoading: false, rightError: null, rightSelected: [],

  splitterPercent: typeof persisted.splitterPercent === "number" ? persisted.splitterPercent : 50,
  // Re-clamped on load: a height persisted under an older, laxer cap
  // (70% once) must not come back over today's limit.
  transferStripHeight: typeof persisted.transferStripHeight === "number"
    ? clampTransferStripPx(persisted.transferStripHeight)
    : TRANSFER_STRIP_DEFAULT_PX,
  transfersExpanded: false,
  currentDrag: null,

  async setLeftPath(p) {
    const resolved = await localRealpath(p).catch(() => p);
    set({ leftPath: resolved, leftSelected: [] });
    persist(get());
    await get().loadLeft();
  },

  async setRightHost(id) {
    // Capture the session's host_id right now so we can still identify
    // the saved host for reconnect after the session is closed/removed.
    // Quick-connect sessions (no saved-host link) resolve to null and
    // therefore can't offer Reconnect — DisconnectedPanel falls back to
    // "Pick different host" in that case.
    const savedHostId = id
      ? useSessions.getState().sessions.find((s) => s.id === id)?.host_id ?? null
      : null;
    // Full reset of error/loading too — v0.5.5 Reconnect flow bug:
    // rightError = "closed" left over from the previous SFTP call
    // survived across the new session id, so the freshly-reconnected
    // pane rendered its content area with a stale "closed" banner and
    // an empty list. Clearing both fields on every host switch prevents
    // any leaked state from a prior host bleeding into the new view.
    set({
      rightHost: id, rightSavedHostId: savedHostId,
      rightPath: "", rightEntries: [], rightSelected: [],
      rightError: null, rightLoading: false,
    });
    persist(get());
    if (id) {
      // sftpRealpath is the "resolve $HOME" call. On a freshly reconnected
      // session it can transiently error with "closed" (russh's SFTP
      // subchannel handshake races the tauri IPC roundtrip). Rather than
      // stamping that stale error onto the pane, fall back to "/" and let
      // loadRight own the error-reporting contract. If that ALSO fails,
      // loadRight sets rightError itself with a meaningful message.
      let home = "/";
      try {
        home = await sftpRealpath(id, ".");
      } catch {
        // ignore — root fallback below
      }
      set({ rightPath: home });
      persist(get());
      await get().loadRight();
    }
  },

  async setRightPath(p) {
    set({ rightPath: p, rightSelected: [] });
    persist(get());
    await get().loadRight();
  },

  async loadLeft() {
    const p = get().leftPath;
    if (!p) return;
    set({ leftLoading: true, leftError: null });
    try {
      const entries = await localListDir(p);
      set({ leftEntries: entries, leftLoading: false });
    } catch (e: any) {
      set({ leftError: String(e), leftLoading: false });
    }
  },

  async loadRight() {
    const { rightHost, rightPath } = get();
    if (!rightHost || !rightPath) return;
    set({ rightLoading: true, rightError: null });
    try {
      const entries = await sftpListDir(rightHost, rightPath);
      set({ rightEntries: entries, rightLoading: false });
    } catch (e: any) {
      set({ rightError: String(e), rightLoading: false });
    }
  },

  toggleSelectLeft(name, multi) {
    const cur = get().leftSelected;
    if (multi) {
      set({ leftSelected: cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name] });
    } else {
      set({ leftSelected: cur.length === 1 && cur[0] === name ? [] : [name] });
    }
  },
  toggleSelectRight(name, multi) {
    const cur = get().rightSelected;
    if (multi) {
      set({ rightSelected: cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name] });
    } else {
      set({ rightSelected: cur.length === 1 && cur[0] === name ? [] : [name] });
    }
  },
  clearSelectionLeft() { set({ leftSelected: [] }); },
  clearSelectionRight() { set({ rightSelected: [] }); },

  setCurrentDrag(d) { set({ currentDrag: d }); },

  transfer(direction) {
    const { leftPath, rightPath, rightHost, leftSelected, rightSelected } = get();
    if (!rightHost) return;
    const join = (base: string, name: string) => base === "/" ? `/${name}` : `${base}/${name}`;
    // A multi-select is one gesture: one group, one strip row.
    if (direction === "up") {
      const group = leftSelected.length >= 2 ? newGesture(leftSelected[0]) : undefined;
      for (const name of leftSelected) {
        const localFullPath = join(leftPath, name);
        const remoteFullPath = join(rightPath, name);
        void sftpUpload(rightHost, localFullPath, remoteFullPath, group);
      }
    } else {
      const group = rightSelected.length >= 2 ? newGesture(rightSelected[0]) : undefined;
      for (const name of rightSelected) {
        const remoteFullPath = join(rightPath, name);
        const localFullPath = join(leftPath, name);
        void sftpDownload(rightHost, remoteFullPath, localFullPath, group);
      }
    }
  },

  // In-memory only — called on every mousemove during a drag. Cheap: no
  // localStorage read/write per event (was the Minor perf finding).
  setSplitterDraft(pct) {
    const clamped = Math.max(20, Math.min(80, pct));
    set({ splitterPercent: clamped });
  },

  // Persists — called once on drag release (mouseup) or on discrete actions
  // like the double-click reset.
  setSplitter(pct) {
    const clamped = Math.max(20, Math.min(80, pct));
    set({ splitterPercent: clamped });
    persist(get());
  },

  // Bottom-transfer-strip resize: draft during drag (no persist),
  // commit on mouseup. The height ONLY applies while a group is
  // expanded; collapsed state pins the strip to the compact height
  // and ignores this value.
  setTransferStripHeightDraft(px) {
    set({ transferStripHeight: clampTransferStripPx(px) });
  },
  setTransferStripHeight(px) {
    set({ transferStripHeight: clampTransferStripPx(px) });
    persist(get());
  },
  toggleTransfersExpanded() {
    set((st) => ({ transfersExpanded: !st.transfersExpanded }));
  },
}));

import { create } from "zustand";
import type { LocalEntry } from "../types/local";
import type { SftpEntry } from "../types/sftp";
import type { ConnectionId } from "../types/connection";
import { localListDir, localRealpath } from "../ipc/local";
import { sftpListDir, sftpRealpath } from "../ipc/sftp";
import { sftpUpload, sftpDownload } from "../ipc/transfers";

interface State {
  leftPath: string;
  leftEntries: LocalEntry[];
  leftLoading: boolean;
  leftError: string | null;
  leftSelected: string[];

  rightHost: ConnectionId | null;
  rightPath: string;
  rightEntries: SftpEntry[];
  rightLoading: boolean;
  rightError: string | null;
  rightSelected: string[];

  splitterPercent: number;
}

interface Actions {
  setLeftPath(p: string): Promise<void>;
  setRightHost(id: ConnectionId | null): Promise<void>;
  setRightPath(p: string): Promise<void>;
  loadLeft(): Promise<void>;
  loadRight(): Promise<void>;
  toggleSelectLeft(name: string, multi: boolean): void;
  toggleSelectRight(name: string, multi: boolean): void;
  clearSelectionLeft(): void;
  clearSelectionRight(): void;
  transfer(direction: "up" | "down"): void;
  setSplitter(pct: number): void;
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
  };
  localStorage.setItem(LS, JSON.stringify(pick));
}

const persisted = loadPersisted() as any;

export const useRailFiles = create<State & Actions>((set, get) => ({
  leftPath: persisted.leftPath ?? "",
  leftEntries: [], leftLoading: false, leftError: null, leftSelected: [],

  rightHost: persisted.rightHost ?? null,
  rightPath: persisted.rightHost ? (persisted.rightPaths?.[persisted.rightHost] ?? "") : "",
  rightEntries: [], rightLoading: false, rightError: null, rightSelected: [],

  splitterPercent: typeof persisted.splitterPercent === "number" ? persisted.splitterPercent : 50,

  async setLeftPath(p) {
    const resolved = await localRealpath(p).catch(() => p);
    set({ leftPath: resolved, leftSelected: [] });
    persist(get());
    await get().loadLeft();
  },

  async setRightHost(id) {
    set({ rightHost: id, rightPath: "", rightEntries: [], rightSelected: [] });
    persist(get());
    if (id) {
      try {
        const home = await sftpRealpath(id, ".");
        set({ rightPath: home });
        persist(get());
        await get().loadRight();
      } catch (e: any) {
        set({ rightError: String(e) });
      }
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

  transfer(direction) {
    const { leftPath, rightPath, rightHost, leftSelected, rightSelected } = get();
    if (!rightHost) return;
    const join = (base: string, name: string) => base === "/" ? `/${name}` : `${base}/${name}`;
    if (direction === "up") {
      for (const name of leftSelected) {
        const localFullPath = join(leftPath, name);
        const remoteFullPath = join(rightPath, name);
        void sftpUpload(rightHost, localFullPath, remoteFullPath);
      }
    } else {
      for (const name of rightSelected) {
        const remoteFullPath = join(rightPath, name);
        const localFullPath = join(leftPath, name);
        void sftpDownload(rightHost, remoteFullPath, localFullPath);
      }
    }
  },

  setSplitter(pct) {
    const clamped = Math.max(20, Math.min(80, pct));
    set({ splitterPercent: clamped });
    persist(get());
  },
}));

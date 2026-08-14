import { create } from "zustand";
import type { MonitorSnapshot } from "../types/monitor";

const MAX_HISTORY = 60;

interface MonitorState {
  snapshots: Record<string, MonitorSnapshot[]>;
  push: (snap: MonitorSnapshot) => void;
  clear: (connId: string) => void;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  snapshots: {},
  push(snap) {
    set((s) => {
      const existing = s.snapshots[snap.connectionId] ?? [];
      const next = [...existing, snap].slice(-MAX_HISTORY);
      return { snapshots: { ...s.snapshots, [snap.connectionId]: next } };
    });
  },
  clear(connId) {
    set((s) => {
      const { [connId]: _dropped, ...rest } = s.snapshots;
      return { snapshots: rest };
    });
  },
}));

import { create } from "zustand";
import type { ActivityKind, ConnectionId, ConnectionInfo } from "../types/connection";

interface SessionsState {
  sessions: ConnectionInfo[];
  activeId: ConnectionId | null;
  activeActivity: Record<ConnectionId, ActivityKind>;

  addSession: (s: ConnectionInfo) => void;
  removeSession: (id: ConnectionId) => void;
  setActive: (id: ConnectionId | null) => void;
  hostIsConnected: (hostId: string) => boolean;

  setActivity: (id: ConnectionId, activity: ActivityKind) => void;
  markSessionClosed: (id: ConnectionId) => void;
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  activeActivity: {},

  addSession: (s) =>
    set((st) => ({
      sessions: [...st.sessions, s],
      activeId: s.id,
      activeActivity: { ...st.activeActivity, [s.id]: "terminal" },
    })),
  removeSession: (id) =>
    set((st) => {
      const remaining = st.sessions.filter((x) => x.id !== id);
      const nextActive =
        st.activeId === id
          ? remaining[remaining.length - 1]?.id ?? null
          : st.activeId;
      const { [id]: _removed, ...restActivity } = st.activeActivity;
      return { sessions: remaining, activeId: nextActive, activeActivity: restActivity };
    }),
  setActive: (id) => set({ activeId: id }),
  hostIsConnected: (hostId) =>
    get().sessions.some((s) => s.host_id === hostId),

  setActivity: (id, activity) =>
    set((st) => ({ activeActivity: { ...st.activeActivity, [id]: activity } })),

  markSessionClosed: (id) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, state: "closed" } : s)),
    })),
}));

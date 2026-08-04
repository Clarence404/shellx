import { create } from "zustand";
import type { ActivityKind, ConnectionId, ConnectionInfo } from "../types/connection";

interface SessionsState {
  sessions: ConnectionInfo[];
  activeId: ConnectionId | null;
  activeActivity: Record<ConnectionId, ActivityKind>;
  /** Host ids currently mid-connect (SSH handshake in flight). Kept as an
   * object-map rather than a Set so shallow-compare selectors work correctly.
   */
  connecting: Record<string, true>;

  addSession: (s: ConnectionInfo) => void;
  removeSession: (id: ConnectionId) => void;
  setActive: (id: ConnectionId | null) => void;
  hostIsConnected: (hostId: string) => boolean;
  beginConnecting: (hostId: string) => void;
  endConnecting: (hostId: string) => void;

  setActivity: (id: ConnectionId, activity: ActivityKind) => void;
  markSessionClosed: (id: ConnectionId) => void;
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  activeActivity: {},
  connecting: {},

  addSession: (s) =>
    set((st) => {
      const { [s.host_id ?? ""]: _dropped, ...restConnecting } = st.connecting;
      return {
        sessions: [...st.sessions, s],
        activeId: s.id,
        activeActivity: { ...st.activeActivity, [s.id]: "terminal" },
        connecting: restConnecting,
      };
    }),
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
  beginConnecting: (hostId) =>
    set((st) => (st.connecting[hostId] ? {} : { connecting: { ...st.connecting, [hostId]: true } })),
  endConnecting: (hostId) =>
    set((st) => {
      if (!st.connecting[hostId]) return {};
      const { [hostId]: _dropped, ...rest } = st.connecting;
      return { connecting: rest };
    }),

  setActivity: (id, activity) =>
    set((st) => ({ activeActivity: { ...st.activeActivity, [id]: activity } })),

  markSessionClosed: (id) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, state: "closed" } : s)),
    })),
}));

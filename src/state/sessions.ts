import { create } from "zustand";
import type { SessionId, SessionInfo } from "../types/session";

interface SessionsState {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  addSession: (s: SessionInfo) => void;
  removeSession: (id: SessionId) => void;
  setActive: (id: SessionId | null) => void;
  hostIsConnected: (hostId: string) => boolean;
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  addSession: (s) =>
    set((st) => ({
      sessions: [...st.sessions, s],
      activeId: s.id,
    })),
  removeSession: (id) =>
    set((st) => {
      const remaining = st.sessions.filter((x) => x.id !== id);
      const nextActive =
        st.activeId === id
          ? remaining[remaining.length - 1]?.id ?? null
          : st.activeId;
      return { sessions: remaining, activeId: nextActive };
    }),
  setActive: (id) => set({ activeId: id }),
  hostIsConnected: (hostId) =>
    get().sessions.some((s) => s.host_id === hostId),
}));

import { create } from "zustand";
import type { ActivityKind, ConnectionId, ConnectionInfo } from "../types/connection";
import type { TunnelStatus } from "../types/tunnel";

export type RailView = "hosts" | "files" | "tunnels" | "serial" | "settings";

interface SessionsState {
  sessions: ConnectionInfo[];
  activeId: ConnectionId | null;
  activeActivity: Record<ConnectionId, ActivityKind>;
  /** Host ids currently mid-connect (SSH handshake in flight). Kept as an
   * object-map rather than a Set so shallow-compare selectors work correctly.
   */
  connecting: Record<string, true>;

  /** Which rail icon is active (Hosts / Files / Serial / Settings). */
  railView: RailView;
  /** Switching to a DIFFERENT view force-opens the drawer; setting the same
   * view is a no-op so it never fights the click-active-toggle path in
   * ActivityRail. */
  setRailView: (v: RailView) => void;
  /** Whether the drawer is collapsed (hidden) for the current rail view. */
  drawerCollapsed: boolean;
  toggleDrawer: () => void;

  addSession: (s: ConnectionInfo) => void;
  removeSession: (id: ConnectionId) => void;
  setActive: (id: ConnectionId | null) => void;
  hostIsConnected: (hostId: string) => boolean;
  beginConnecting: (hostId: string) => void;
  endConnecting: (hostId: string) => void;

  setActivity: (id: ConnectionId, activity: ActivityKind) => void;
  /** Rename a tab. Display only — the saved host keeps its own label, so
   *  this dies with the session. */
  renameSession: (id: ConnectionId, label: string) => void;
  markSessionClosed: (id: ConnectionId) => void;

  tunnelStatuses: Record<string, TunnelStatus[]>;
  setTunnelStatus: (sessionId: string, status: TunnelStatus) => void;
  removeTunnelStatus: (sessionId: string, ruleId: string) => void;
  clearTunnelStatuses: (sessionId: string) => void;

  /** rule_id → session_id for every rule believed to be running.
   *  Lives here rather than in the Tunnels view so it survives a remount,
   *  and is re-derived from `tunnel_list_active` on startup — the backend
   *  is the authority on what is actually forwarding. */
  tunnelRuleSessions: Record<string, string>;
  /** rule_id → true once the rule has been seen active this run. Tells
   *  "first connect in progress" apart from "reconnecting". */
  tunnelEverActive: Record<string, true>;
  registerTunnelRuleSession: (ruleId: string, sessionId: string) => void;
  forgetTunnelRuleSession: (ruleId: string) => void;
  markTunnelEverActive: (ruleIds: string[]) => void;
  /** Replace the whole map with what the backend reports. Rules the
   *  backend does not list are dropped, so a stale entry can't keep
   *  showing a stopped tunnel as running. */
  reconcileTunnelRuleSessions: (pairs: Array<{ ruleId: string; sessionId: string }>) => void;

  /** Incremented whenever tunnel rules for a host change (add/delete).
   *  TunnelsPanel subscribes to this to know when to re-fetch. */
  rulesVersion: Record<string, number>;
  bumpRulesVersion: (hostId: string) => void;
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  activeActivity: {},
  connecting: {},
  tunnelStatuses: {},
  tunnelRuleSessions: {},
  tunnelEverActive: {},
  rulesVersion: {},

  railView: "hosts",
  setRailView: (v) => set((st) => (
    st.railView === v ? {} : { railView: v, drawerCollapsed: false }
  )),
  drawerCollapsed: false,
  toggleDrawer: () => set((st) => ({ drawerCollapsed: !st.drawerCollapsed })),

  addSession: (s) =>
    set((st) => {
      const { [s.host_id ?? ""]: _dropped, ...restConnecting } = st.connecting;
      return {
        sessions: [...st.sessions, s],
        activeId: s.id,
        activeActivity: { ...st.activeActivity, [s.id]: "terminal" },
        connecting: restConnecting,
        // Auto-collapse the HOSTS drawer once the session is live — the
        // user just picked a host, so the list has served its purpose;
        // give the terminal full width instead. They can reopen it any
        // time via the rail Hosts icon click or Ctrl+Shift+B.
        drawerCollapsed: true,
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

  renameSession: (id, label) =>
    set((st) => ({
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, label: label } : s)),
    })),

  markSessionClosed: (id) =>
    set((st) => {
      const { [id]: _dropped, ...restTunnels } = st.tunnelStatuses;
      return {
        sessions: st.sessions.map((s) => (s.id === id ? { ...s, state: "closed" } : s)),
        tunnelStatuses: restTunnels,
      };
    }),

  setTunnelStatus: (sessionId, status) =>
    set((s) => {
      const existing = s.tunnelStatuses[sessionId] ?? [];
      const idx = existing.findIndex((t) => t.rule_id === status.rule_id);
      const updated = idx >= 0
        ? existing.map((t, i) => (i === idx ? { ...t, ...status } : t))
        : [...existing, status];
      return { tunnelStatuses: { ...s.tunnelStatuses, [sessionId]: updated } };
    }),

  removeTunnelStatus: (sessionId, ruleId) =>
    set((s) => ({
      tunnelStatuses: {
        ...s.tunnelStatuses,
        [sessionId]: (s.tunnelStatuses[sessionId] ?? []).filter((t) => t.rule_id !== ruleId),
      },
    })),

  clearTunnelStatuses: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.tunnelStatuses;
      return { tunnelStatuses: rest };
    }),

  registerTunnelRuleSession: (ruleId, sessionId) =>
    set((s) => (
      s.tunnelRuleSessions[ruleId] === sessionId
        ? {}
        : { tunnelRuleSessions: { ...s.tunnelRuleSessions, [ruleId]: sessionId } }
    )),

  forgetTunnelRuleSession: (ruleId) =>
    set((s) => {
      if (!(ruleId in s.tunnelRuleSessions) && !(ruleId in s.tunnelEverActive)) return {};
      const { [ruleId]: _drop, ...restSessions } = s.tunnelRuleSessions;
      const { [ruleId]: _drop2, ...restActive } = s.tunnelEverActive;
      return { tunnelRuleSessions: restSessions, tunnelEverActive: restActive };
    }),

  markTunnelEverActive: (ruleIds) =>
    set((s) => {
      let changed = false;
      const next = { ...s.tunnelEverActive };
      for (const id of ruleIds) {
        if (!next[id]) { next[id] = true; changed = true; }
      }
      return changed ? { tunnelEverActive: next } : {};
    }),

  reconcileTunnelRuleSessions: (pairs) =>
    set(() => {
      const next: Record<string, string> = {};
      for (const p of pairs) next[p.ruleId] = p.sessionId;
      // Anything the backend reports as running has demonstrably been
      // active, so the pills read "reconnecting" rather than "connecting"
      // if one of them drops later in this run.
      const active: Record<string, true> = {};
      for (const p of pairs) active[p.ruleId] = true;
      return { tunnelRuleSessions: next, tunnelEverActive: active };
    }),

  bumpRulesVersion: (hostId) =>
    set((s) => ({
      rulesVersion: { ...s.rulesVersion, [hostId]: (s.rulesVersion[hostId] ?? 0) + 1 },
    })),
}));

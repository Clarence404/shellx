import { create } from "zustand";
import type { ActivityKind, ConnectionId, ConnectionInfo } from "../types/connection";
import type { TunnelStatus } from "../types/tunnel";
import * as tree from "./paneTree";
import type { DropZone, PaneNode } from "./paneTree";

export type RailView = "hosts" | "files" | "ftp" | "tunnels" | "serial" | "settings";

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

  /** Split layout over the session list. null = one pane showing
   *  `activeId`, which is how the app runs until the user drags a tab
   *  into the main area. `activeId` is always the focused pane. */
  layout: PaneNode | null;
  /** Put `sessionId` beside the pane showing `targetId`. */
  splitPane: (targetId: ConnectionId, zone: Exclude<DropZone, "center">, sessionId: ConnectionId) => void;
  /** Put `sessionId` outside everything — a full-width row or full-height column. */
  splitRoot: (zone: Exclude<DropZone, "center">, sessionId: ConnectionId) => void;
  /** Relocate a pane that is already on screen. */
  movePane: (sessionId: ConnectionId, targetId: ConnectionId, zone: Exclude<DropZone, "center">) => void;
  moveRoot: (sessionId: ConnectionId, zone: Exclude<DropZone, "center">) => void;
  swapPanes: (a: ConnectionId, b: ConnectionId) => void;
  /** Point a pane at another session; the displaced one stays a plain tab. */
  replacePane: (targetId: ConnectionId, sessionId: ConnectionId) => void;
  /** Take a pane out of the layout. The session stays open as a tab. */
  popPane: (sessionId: ConnectionId) => void;
  equalizeRow: (path: string) => void;
  equalizeLayout: () => void;
  setPaneBoundary: (path: string, index: number, fraction: number) => void;
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
  layout: null,
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
      // A closed session must leave the layout with it, or its pane would
      // point at a tab that no longer exists.
      const layout = tree.normalize(tree.dropPane(st.layout, id));
      const shown = tree.paneIds(layout);
      const activeId = layout && (!nextActive || !shown.includes(nextActive))
        ? shown[0] ?? null
        : nextActive;
      return { sessions: remaining, activeId, activeActivity: restActivity, layout };
    }),
  setActive: (id) =>
    set((st) => {
      // With a split up, focusing a session that isn't on screen puts it
      // in the pane you were looking at rather than tearing the layout
      // down. Focusing one that IS on screen just moves the focus.
      if (!id || !st.layout || tree.hasPane(st.layout, id)) return { activeId: id };
      const focused = st.activeId && tree.hasPane(st.layout, st.activeId)
        ? st.activeId
        : tree.paneIds(st.layout)[0];
      if (!focused) return { activeId: id };
      return { layout: tree.replacePane(st.layout, focused, id), activeId: id };
    }),
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

  splitPane: (targetId, zone, sessionId) =>
    set((st) => {
      const base = st.layout ?? tree.leaf(st.activeId ?? targetId);
      if (!tree.hasPane(base, targetId)) return {};
      return { layout: tree.splitPane(base, targetId, zone, sessionId), activeId: sessionId };
    }),

  splitRoot: (zone, sessionId) =>
    set((st) => {
      const base = st.layout ?? (st.activeId ? tree.leaf(st.activeId) : null);
      return { layout: tree.wrapRoot(base, zone, sessionId), activeId: sessionId };
    }),

  movePane: (sessionId, targetId, zone) =>
    set((st) => {
      if (!st.layout || sessionId === targetId) return {};
      const without = tree.dropPane(st.layout, sessionId);
      if (!without || !tree.hasPane(without, targetId)) return {};
      return { layout: tree.splitPane(without, targetId, zone, sessionId), activeId: sessionId };
    }),

  moveRoot: (sessionId, zone) =>
    set((st) => {
      if (!st.layout) return {};
      const without = tree.dropPane(st.layout, sessionId);
      if (!without) return {};
      return { layout: tree.wrapRoot(without, zone, sessionId), activeId: sessionId };
    }),

  swapPanes: (a, b) =>
    set((st) => (st.layout ? { layout: tree.swapPanes(st.layout, a, b), activeId: a } : {})),

  replacePane: (targetId, sessionId) =>
    set((st) => (st.layout
      ? { layout: tree.replacePane(st.layout, targetId, sessionId), activeId: sessionId }
      : { activeId: sessionId })),

  popPane: (sessionId) =>
    set((st) => {
      if (!st.layout) return {};
      const next = tree.normalize(tree.dropPane(st.layout, sessionId));
      const stillShown = tree.paneIds(next);
      return {
        layout: next,
        activeId: next === null
          ? (stillShown[0] ?? st.activeId)
          : (st.activeId && stillShown.includes(st.activeId) ? st.activeId : stillShown[0]),
      };
    }),

  equalizeRow: (path) =>
    set((st) => (st.layout ? { layout: tree.equalizePath(st.layout, path) } : {})),

  equalizeLayout: () =>
    set((st) => (st.layout ? { layout: tree.equalizeAll(st.layout) } : {})),

  setPaneBoundary: (path, index, fraction) =>
    set((st) => (st.layout ? { layout: tree.setBoundary(st.layout, path, index, fraction) } : {})),

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

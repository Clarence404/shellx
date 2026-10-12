import { create } from "zustand";
import type { Alert } from "../types/alerts";
import type { MonitorSnapshot } from "../types/monitor";
import type { ConnectionInfo } from "../types/connection";
import { evaluate } from "./alertRules";
import { useSettingsStore } from "./settings";

/** How long a recovered alert stays in the list before it is dropped.
 *  Long enough to notice "that cleared itself", short enough that the
 *  Alerts tab isn't a log. */
const KEEP_CLEARED_MS = 10 * 60_000;

/** Cap per connection, so a host with dozens of failing units can't grow
 *  the list without bound. Active alerts are kept ahead of cleared ones. */
const MAX_PER_CONN = 50;

interface AlertsState {
  byConn: Record<string, Alert[]>;
  /** Fold one snapshot in. Returns the alerts that fired on it, so the
   *  caller can notify — the store itself raises nothing. */
  ingest(snap: MonitorSnapshot, now?: number): Alert[];
  /** Drop everything for a connection (it closed). */
  clear(connId: string): void;
  /** Drop every alert everywhere — alerts were switched off. */
  clearAll(): void;
}

function prune(alerts: Alert[], now: number): Alert[] {
  const kept = alerts.filter((a) => a.clearedAt === null || now - a.clearedAt < KEEP_CLEARED_MS);
  if (kept.length <= MAX_PER_CONN) return kept;
  // Active first, then the most recently cleared.
  const ordered = [...kept].sort((a, b) => {
    if ((a.clearedAt === null) !== (b.clearedAt === null)) return a.clearedAt === null ? -1 : 1;
    return (b.clearedAt ?? 0) - (a.clearedAt ?? 0);
  });
  return ordered.slice(0, MAX_PER_CONN);
}

export const useAlerts = create<AlertsState>((set, get) => ({
  byConn: {},

  ingest(snap, now = Date.now()) {
    const settings = useSettingsStore.getState().alerts;
    const prev = get().byConn[snap.connectionId] ?? [];
    if (!settings.enabled) {
      if (prev.length) get().clear(snap.connectionId);
      return [];
    }
    const { alerts, fired } = evaluate(snap, settings, prev, now);
    set((s) => ({ byConn: { ...s.byConn, [snap.connectionId]: prune(alerts, now) } }));
    return fired;
  },

  clear(connId) {
    set((s) => {
      if (!(connId in s.byConn)) return s;
      const { [connId]: _dropped, ...rest } = s.byConn;
      return { byConn: rest };
    });
  },

  clearAll() {
    set({ byConn: {} });
  },
}));

/** Alerts still breaching for one connection, newest first. */
export function activeAlerts(byConn: Record<string, Alert[]>, connId: string): Alert[] {
  return (byConn[connId] ?? []).filter((a) => a.clearedAt === null);
}

/** Every alert for one connection — active ones first, then what
 *  recently recovered. */
export function alertsFor(byConn: Record<string, Alert[]>, connId: string): Alert[] {
  const all = byConn[connId] ?? [];
  return [...all].sort((a, b) => {
    if ((a.clearedAt === null) !== (b.clearedAt === null)) return a.clearedAt === null ? -1 : 1;
    return b.since - a.since;
  });
}

/** Active alert count per connection, for the sidebar badge. */
export function activeCounts(byConn: Record<string, Alert[]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, list] of Object.entries(byConn)) {
    const n = list.filter((a) => a.clearedAt === null).length;
    if (n > 0) out[id] = n;
  }
  return out;
}

/** Active alerts per host id, summed over that host's open sessions —
 *  what the sidebar badges. A host with two sessions to it shows one
 *  badge with both counts in it. */
export function alertCountByHost(
  byConn: Record<string, Alert[]>,
  sessions: ConnectionInfo[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sessions) {
    if (!s.host_id) continue;
    const n = (byConn[s.id] ?? []).filter((a) => a.clearedAt === null).length;
    if (n > 0) out[s.host_id] = (out[s.host_id] ?? 0) + n;
  }
  return out;
}

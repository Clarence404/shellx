/**
 * Grouping and searching the saved-hosts list — everything that can be done
 * without a DOM. The drawer renders what `buildView` returns and keeps no
 * grouping logic of its own. See
 * docs/superpowers/specs/2026-10-12-v0.35-host-groups-and-search-design.md.
 *
 * A group is not a stored thing: it exists exactly while some host's
 * `group_name` names it.
 */
import type { HostInfo } from "../types/host";

export interface GroupHeader {
  kind: "group";
  name: string;
  /** Members shown — all of them normally, only the matches while searching. */
  total: number;
  /** Of those, how many have a live session. */
  online: number;
  open: boolean;
}

/** Label over the hosts that belong to no group. Only present once at least
 *  one group exists — with none, the list is flat and needs no label. */
export interface UngroupedHeader {
  kind: "ungrouped";
  total: number;
}

export interface HostItem {
  kind: "host";
  host: HostInfo;
  /** Sits under a group header (drawn indented). */
  grouped: boolean;
}

export type ViewItem = GroupHeader | UngroupedHeader | HostItem;

export interface HostView {
  items: ViewItem[];
  /** The hosts actually on screen, top to bottom. Multi-select addresses rows
   *  by index into THIS list — headers, collapsed members and filtered-out
   *  hosts are not in it, so a Shift range can never sweep up a row the user
   *  cannot see. */
  visibleIds: string[];
  /** Hosts matching the query (all hosts when there is none). */
  matchCount: number;
}

// Locale-aware, numeric-aware: "db2" before "db10", and CJK names sort
// sensibly rather than by code point.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** A host's group, normalised: blank is "no group". */
export function groupOf(h: HostInfo): string | null {
  const g = h.group_name?.trim();
  return g ? g : null;
}

/** Distinct group names in display order. */
export function groupNames(hosts: HostInfo[]): string[] {
  const set = new Set<string>();
  for (const h of hosts) {
    const g = groupOf(h);
    if (g) set.add(g);
  }
  return [...set].sort(collator.compare);
}

/** Case-insensitive substring over label, address, username and group name.
 *  A group-name hit therefore matches every member, which shows the whole
 *  group. */
export function matchesQuery(h: HostInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [h.label, h.host, h.username, groupOf(h) ?? ""].some((f) => f.toLowerCase().includes(q));
}

export function buildView(
  hosts: HostInfo[],
  query: string,
  collapsed: ReadonlySet<string>,
  isOnline: (hostId: string) => boolean,
): HostView {
  const searching = query.trim() !== "";
  const matched = hosts.filter((h) => matchesQuery(h, query));
  const hasGroups = hosts.some((h) => groupOf(h) !== null);

  const items: ViewItem[] = [];
  const visibleIds: string[] = [];

  for (const name of groupNames(hosts)) {
    const members = matched.filter((h) => groupOf(h) === name);
    if (members.length === 0) continue; // nothing to show for it while searching
    // A query overrides the remembered collapsed state: the point of
    // searching is to see the hits.
    const open = searching ? true : !collapsed.has(name);
    items.push({
      kind: "group",
      name,
      total: members.length,
      online: members.filter((h) => isOnline(h.id)).length,
      open,
    });
    if (open) {
      for (const h of members) {
        items.push({ kind: "host", host: h, grouped: true });
        visibleIds.push(h.id);
      }
    }
  }

  const loose = matched.filter((h) => groupOf(h) === null);
  if (loose.length > 0) {
    if (hasGroups) items.push({ kind: "ungrouped", total: loose.length });
    for (const h of loose) {
      items.push({ kind: "host", host: h, grouped: false });
      visibleIds.push(h.id);
    }
  }

  return { items, visibleIds, matchCount: matched.length };
}

/** Splits `text` around the first occurrence of `query` so the match can be
 *  highlighted. No query, or no occurrence, gives one plain segment. */
export function splitHighlight(text: string, query: string): { text: string; hit: boolean }[] {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return [{ text, hit: false }];
  return [
    ...(i > 0 ? [{ text: text.slice(0, i), hit: false }] : []),
    { text: text.slice(i, i + q.length), hit: true },
    ...(i + q.length < text.length ? [{ text: text.slice(i + q.length), hit: false }] : []),
  ];
}

// ── collapsed state, remembered across launches ────────────────────────────

const COLLAPSED_KEY = "shellx.hostGroupsCollapsed";

export function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveCollapsed(collapsed: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch { /* private mode — fine, it just won't be remembered */ }
}

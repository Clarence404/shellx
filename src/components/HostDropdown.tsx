import { useEffect, useRef, useState } from "react";
import { Server, ChevronDown, Plus } from "lucide-react";
import { useSessions } from "../state/sessions";
import { useHostsStore } from "../state/hosts";
import { useIconSizes } from "../state/settings";
import type { HostInfo } from "../types/host";
import type { ConnectionInfo } from "../types/connection";

interface Props {
  /** ConnectionId of the currently-picked remote host (may be null). */
  currentHost: string | null;
  /** Fires when the user picks an already-connected host. */
  onSelect: (id: string | null) => void;
  /**
   * Fires when the user picks a saved host that has no active session yet.
   * Parent should initiate the connect flow; RailFilesView's growth watcher
   * will auto-set rightHost once the resulting addSession lands.
   */
  onConnectSavedHost?: (host: HostInfo) => void;
  onNewConnection: () => void;
}

interface Row {
  hostId: string;
  label: string;
  session: ConnectionInfo | null;
  savedHost: HostInfo | null;
}

/**
 * Merges saved hosts (persisted in SQLite via useHostsStore) with active
 * sessions (useSessions.sessions), so the dropdown behaves like a host
 * picker: every saved host is reachable in one click, whether connected or
 * not. Quick-connect sessions (no saved host_id link) also appear, using
 * the session id as the row key.
 */
function buildRows(hosts: HostInfo[], sessions: ConnectionInfo[]): Row[] {
  const rows: Row[] = [];
  const claimedSessions = new Set<string>();
  for (const h of hosts) {
    const session = sessions.find((s) => s.host_id === h.id) ?? null;
    if (session) claimedSessions.add(session.id);
    rows.push({ hostId: h.id, label: h.label, session, savedHost: h });
  }
  // Quick-connect sessions (no host_id): show under their session label so
  // they don't disappear from the picker just because they weren't saved.
  for (const s of sessions) {
    if (claimedSessions.has(s.id)) continue;
    if (s.host_id) continue;
    rows.push({ hostId: s.id, label: s.label, session: s, savedHost: null });
  }
  return rows;
}

export function HostDropdown({ currentHost, onSelect, onConnectSavedHost, onNewConnection }: Props) {
  const sessions = useSessions((s) => s.sessions);
  const connecting = useSessions((s) => s.connecting);
  const hosts = useHostsStore((s) => s.hosts);
  const iconSizes = useIconSizes();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const rows = buildRows(hosts, sessions);
  const active = sessions.find((s) => s.id === currentHost);
  const label = active?.label ?? "Pick a host";

  function handleRowClick(row: Row) {
    if (row.session) {
      onSelect(row.session.id);
    } else if (row.savedHost && onConnectSavedHost) {
      onConnectSavedHost(row.savedHost);
    }
    setOpen(false);
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox" aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "var(--pad-row-y) var(--pad-row-x)",
          fontSize: "var(--font-small)", color: "var(--text-1)", background: "var(--panel-1)",
          border: "1px solid var(--border)", borderRadius: 5,
          fontFamily: "\"JetBrains Mono\", var(--font-mono)",
        }}>
        <Server size={iconSizes.md} color="var(--text-2)" />
        <span>{label}</span>
        <ChevronDown size={iconSizes.sm} color="var(--text-3)" />
      </button>
      {open && (
        <ul ref={listRef} role="listbox" style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          minWidth: 220, background: "var(--panel-2)",
          border: "0.5px solid var(--border)", borderRadius: 6,
          padding: 4, zIndex: 100, listStyle: "none",
        }}>
          {rows.length === 0 && (
            <li style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-3)" }}>
              No saved hosts yet
            </li>
          )}
          {rows.map((row) => {
            const isActive = row.session?.state === "active";
            const isConnecting = row.savedHost ? !!connecting[row.savedHost.id] : false;
            return (
              <li key={row.hostId} role="option"
                aria-selected={row.session?.id === currentHost || undefined}
                onClick={() => handleRowClick(row)}
                style={{
                  padding: "var(--pad-row-y) var(--pad-row-x)", fontSize: "var(--font-small)", color: "var(--text-1)",
                  cursor: "pointer", borderRadius: 4,
                  display: "flex", alignItems: "center", gap: 6,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--border)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: "var(--accent)",
                  opacity: isActive ? 1 : (isConnecting ? 1 : 0.3),
                  animation: isConnecting ? "hostrow-pulse 900ms ease-in-out infinite" : undefined,
                }} />
                <span style={{ flex: 1 }}>{row.label}</span>
                {!row.session && (
                  <span style={{ fontSize: 9, color: "var(--text-3)" }}>connect</span>
                )}
              </li>
            );
          })}
          <li role="option"
            onClick={() => { onNewConnection(); setOpen(false); }}
            style={{
              padding: "var(--pad-row-y) var(--pad-row-x)", fontSize: "var(--font-small)", color: "var(--text-1)",
              cursor: "pointer", borderRadius: 4, borderTop: "0.5px solid var(--border)",
              marginTop: 4, display: "flex", alignItems: "center", gap: 6,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--border)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Plus size={iconSizes.sm} /> New connection
          </li>
        </ul>
      )}
    </div>
  );
}

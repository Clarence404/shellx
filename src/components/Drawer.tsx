import { Plus, PanelLeftClose } from "lucide-react";
import { HostRow } from "./HostRow";
import { SectionHeader } from "./SectionHeader";
import { useHostsStore } from "../state/hosts";
import { useSessions } from "../state/sessions";
import { useRailFiles } from "../state/railFiles";
import { closeSession } from "../ipc/commands";
import type { HostInfo } from "../types/host";
import type { RailView } from "./ActivityRail";

interface Props {
  view: RailView;
  onNewConnection?: () => void;
  onEditHost?: (host: HostInfo) => void;
  onConnectHost?: (host: HostInfo, forceNew?: boolean) => void;
}

export function Drawer({ view, onNewConnection, onEditHost, onConnectHost }: Props) {
  const hosts = useHostsStore((s) => s.hosts);
  const deleteHostById = useHostsStore((s) => s.deleteHostById);
  const addHost = useHostsStore((s) => s.addHost);
  const hostIsConnected = useSessions((s) => s.hostIsConnected);
  const connecting = useSessions((s) => s.connecting);
  // Host of the currently active tab — its row keeps a highlight so the
  // drawer always shows which host the foreground tab belongs to.
  const activeHostId = useSessions((s) => s.sessions.find((x) => x.id === s.activeId)?.host_id ?? null);
  const drawerCollapsed = useSessions((s) => s.drawerCollapsed);
  const toggleDrawer = useSessions((s) => s.toggleDrawer);

  // Views that own their own internal chrome (RailFilesView has its own
  // rail+drawer replacement, SettingsView has SettingsSidebar) don't need the
  // outer Drawer. Serial is a bare "coming soon" placeholder — also skip.
  if (view !== "hosts" || drawerCollapsed) return null;
  // Fresh-install empty state: with no saved hosts, the drawer would only
  // show a "HOSTS" caps label and the "+ New connection" button — the
  // main-area EmptyState already offers that action prominently, so the
  // empty drawer is just visual noise. Hide until the user saves their
  // first host; the drawer then reappears automatically. Manual toggle
  // via rail click still respected once hosts.length > 0.
  if (hosts.length === 0) return null;

  async function handleDelete(host: HostInfo) {
    if (!confirm(`Delete "${host.label}"?`)) return;
    // Cascade cleanup before removing the row: any tab whose session's
    // host_id matches gets its backend closed + removed from the store,
    // and if the RemotePane was pointing at one of those sessions, reset
    // it to "Pick a host". Order matters — do this BEFORE deleteHostById
    // so if any step throws, the saved-host row is still there and the
    // user can retry rather than being left with a dangling tab and no
    // way to re-associate it.
    const linkedSessionIds = useSessions.getState().sessions
      .filter((s) => s.host_id === host.id)
      .map((s) => s.id);
    for (const id of linkedSessionIds) {
      try { await closeSession(id); } catch { /* backend may be gone; keep going */ }
      useSessions.getState().removeSession(id);
    }
    const railFiles = useRailFiles.getState();
    if (railFiles.rightHost && linkedSessionIds.includes(railFiles.rightHost)) {
      railFiles.setRightHost(null);
    }
    await deleteHostById(host.id);
  }

  async function handleDuplicate(host: HostInfo) {
    await addHost({
      label: `${host.label} (copy)`,
      host: host.host,
      port: host.port,
      username: host.username,
    });
  }

  // Close every live session tied to this saved host — keep the host row
  // itself. Also reset RemotePane if it was pointing at one of the closed
  // sessions, same guard as handleDelete uses (but without dropping the
  // saved host).
  async function handleDisconnect(host: HostInfo) {
    const linkedSessionIds = useSessions.getState().sessions
      .filter((s) => s.host_id === host.id)
      .map((s) => s.id);
    for (const id of linkedSessionIds) {
      try { await closeSession(id); } catch { /* backend may be gone */ }
      useSessions.getState().removeSession(id);
    }
    const railFiles = useRailFiles.getState();
    if (railFiles.rightHost && linkedSessionIds.includes(railFiles.rightHost)) {
      railFiles.setRightHost(null);
    }
  }

  return (
    <aside aria-label="drawer" style={{
      width: "var(--drawer-w)", flexShrink: 0, background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", padding: "10px 12px",
      display: "flex", flexDirection: "column",
    }}>
      <SectionHeader
        label={view}
        action={
          <button
            aria-label="Collapse drawer"
            title={navigator.userAgent.includes("Mac") ? "Collapse (⌘+B)" : "Collapse (Ctrl+Shift+B)"}
            onClick={toggleDrawer}
            style={{
              color: "var(--text-3)", padding: "2px 4px", borderRadius: 3,
              display: "flex", alignItems: "center",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-1)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-3)"; }}
          >
            <PanelLeftClose size={12} strokeWidth={2} />
          </button>
        }
      />
      <div style={{ flex: 1, overflow: "auto", marginBottom: 8 }}>
        {view === "hosts" && hosts.map((h) => {
          const connected = hostIsConnected(h.id);
          return (
            <HostRow
              key={h.id}
              host={h}
              isConnected={connected}
              isConnecting={!!connecting[h.id]}
              isActive={h.id === activeHostId}
              onConnect={() => onConnectHost?.(h)}
              onOpenNewShell={() => onConnectHost?.(h, true)}
              // Disconnect only surfaces when at least one live session
              // matches this host_id — otherwise there's nothing to close
              // and the menu item would confuse.
              onDisconnect={connected ? () => void handleDisconnect(h) : undefined}
              onEdit={() => onEditHost?.(h)}
              onDuplicate={() => handleDuplicate(h)}
              onDelete={() => handleDelete(h)}
            />
          );
        })}
      </div>
      {view === "hosts" && onNewConnection && (
        <button onClick={onNewConnection}
          style={{
            padding: "6px 8px", borderRadius: 5,
            background: "var(--accent-fade)", color: "var(--text-1)",
            border: "1px solid var(--accent)", fontSize: "var(--font-ui-size)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
          <Plus size={12} strokeWidth={2.5} />
          New connection
        </button>
      )}
    </aside>
  );
}

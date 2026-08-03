import { Plus } from "lucide-react";
import { HostRow } from "./HostRow";
import { useHostsStore } from "../state/hosts";
import { useSessions } from "../state/sessions";
import type { HostInfo } from "../types/host";
import type { RailView } from "./ActivityRail";

interface Props {
  view: RailView;
  onNewConnection?: () => void;
  onEditHost?: (host: HostInfo) => void;
  onConnectHost?: (host: HostInfo) => void;
}

export function Drawer({ view, onNewConnection, onEditHost, onConnectHost }: Props) {
  const hosts = useHostsStore((s) => s.hosts);
  const deleteHostById = useHostsStore((s) => s.deleteHostById);
  const addHost = useHostsStore((s) => s.addHost);
  const hostIsConnected = useSessions((s) => s.hostIsConnected);

  async function handleDelete(host: HostInfo) {
    if (!confirm(`Delete "${host.label}"?`)) return;
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

  return (
    <aside aria-label="drawer" style={{
      width: "var(--drawer-w)", background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", padding: "10px 12px",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
        color: "var(--text-3)", marginBottom: 8,
      }}>{view}</div>
      <div style={{ flex: 1, overflow: "auto", marginBottom: 8 }}>
        {view === "hosts" && hosts.map((h) => (
          <HostRow
            key={h.id}
            host={h}
            isConnected={hostIsConnected(h.id)}
            onConnect={() => onConnectHost?.(h)}
            onEdit={() => onEditHost?.(h)}
            onDuplicate={() => handleDuplicate(h)}
            onDelete={() => handleDelete(h)}
          />
        ))}
      </div>
      {view === "hosts" && onNewConnection && (
        <button onClick={onNewConnection}
          style={{
            padding: "6px 8px", borderRadius: 5,
            background: "var(--accent-fade)", color: "var(--text-1)",
            border: "1px solid var(--accent)", fontSize: 12,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}>
          <Plus size={12} strokeWidth={2.5} />
          New connection
        </button>
      )}
    </aside>
  );
}

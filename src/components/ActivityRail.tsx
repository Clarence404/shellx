import { Monitor, Files, Cable, Settings, type LucideIcon } from "lucide-react";
import { useSessions, type RailView } from "../state/sessions";

export type { RailView };

const ITEMS: { id: RailView; label: string; Icon: LucideIcon }[] = [
  { id: "hosts", label: "Hosts", Icon: Monitor },
  { id: "files", label: "Files", Icon: Files },
  { id: "protocols", label: "Protocols", Icon: Cable },
  { id: "settings", label: "Settings", Icon: Settings },
];

export function ActivityRail() {
  const activeView = useSessions((s) => s.railView);
  const setView = useSessions((s) => s.setRailView);
  const toggleDrawer = useSessions((s) => s.toggleDrawer);
  return (
    <nav aria-label="activity rail" style={{
      width: "var(--rail-w)", flexShrink: 0, background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", display: "flex",
      flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0",
    }}>
      {ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          aria-label={label}
          aria-current={activeView === id ? "page" : undefined}
          onClick={() => (activeView === id ? toggleDrawer() : setView(id))}
          style={{
            width: 28, height: 28, borderRadius: 6,
            background: activeView === id ? "var(--accent)" : "transparent",
            color: activeView === id ? "var(--text-on-accent)" : "var(--text-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0,
          }}>
          <Icon size={18} strokeWidth={1.8} />
        </button>
      ))}
    </nav>
  );
}

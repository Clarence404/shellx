import { Monitor, Files, Cable, Settings, type LucideIcon } from "lucide-react";

export type RailView = "hosts" | "files" | "protocols" | "settings";

const ITEMS: { id: RailView; label: string; Icon: LucideIcon }[] = [
  { id: "hosts", label: "Hosts", Icon: Monitor },
  { id: "files", label: "Files", Icon: Files },
  { id: "protocols", label: "Protocols", Icon: Cable },
  { id: "settings", label: "Settings", Icon: Settings },
];

export function ActivityRail({
  activeView, onSelect,
}: { activeView: RailView; onSelect: (v: RailView) => void }) {
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
          onClick={() => onSelect(id)}
          style={{
            width: 24, height: 24, borderRadius: 5,
            background: activeView === id ? "var(--accent)" : "transparent",
            color: activeView === id ? "var(--text-on-accent)" : "var(--text-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 0,
          }}>
          <Icon size={16} strokeWidth={1.8} />
        </button>
      ))}
    </nav>
  );
}

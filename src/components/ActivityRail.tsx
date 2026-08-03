export type RailView = "hosts" | "files" | "protocols" | "settings";
const ITEMS: { id: RailView; label: string; icon: string }[] = [
  { id: "hosts", label: "Hosts", icon: "🖥" },
  { id: "files", label: "Files", icon: "📁" },
  { id: "protocols", label: "Protocols", icon: "🔌" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export function ActivityRail({
  activeView, onSelect,
}: { activeView: RailView; onSelect: (v: RailView) => void }) {
  return (
    <nav aria-label="activity rail" style={{
      width: "var(--rail-w)", background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", display: "flex",
      flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0"
    }}>
      {ITEMS.map((it) => (
        <button
          key={it.id}
          aria-label={it.label}
          aria-current={activeView === it.id ? "page" : undefined}
          onClick={() => onSelect(it.id)}
          style={{
            width: 24, height: 24, borderRadius: 5,
            background: activeView === it.id ? "var(--accent)" : "transparent",
            color: activeView === it.id ? "var(--text-on-accent)" : "var(--text-2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13,
          }}
        >{it.icon}</button>
      ))}
    </nav>
  );
}

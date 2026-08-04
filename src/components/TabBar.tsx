import { Plus } from "lucide-react";

export type Tab = { id: string; title: string; state?: "active" | "closed" };

export function TabBar({
  tabs, activeTabId, onSelect, onClose, onNewConnection,
}: {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewConnection?: () => void;
}) {
  return (
    <div role="tablist" style={{
      height: "var(--tab-h)", background: "var(--panel-1)",
      borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "flex-end",
      padding: "0 6px", gap: 2,
      overflowX: "auto",
    }}>
      {tabs.map((t) => (
        <div key={t.id} role="tab" aria-selected={t.id === activeTabId}
          onClick={() => onSelect(t.id)}
          style={{
            padding: "4px 10px", borderRadius: "5px 5px 0 0", fontSize: 11,
            background: t.id === activeTabId ? "var(--panel-2)" : "transparent",
            color: t.id === activeTabId ? "var(--text-1)" : "var(--text-3)",
            display: "flex", alignItems: "center", gap: 6,
            cursor: "pointer", flexShrink: 0,
            whiteSpace: "nowrap",
            opacity: t.state === "closed" ? 0.4 : 1,
            filter: t.state === "closed" ? "grayscale(0.6)" : "none",
            transition: "opacity 300ms, filter 300ms",
            pointerEvents: t.state === "closed" ? "none" : "auto",
          }}>
          {t.title}
          <span
            onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
            aria-label={`close ${t.title}`}
            style={{ opacity: 0.6, fontSize: 10 }}>×</span>
        </div>
      ))}
      {onNewConnection && (
        <button
          onClick={onNewConnection}
          aria-label="new connection"
          style={{
            padding: "4px 8px", marginLeft: 4,
            background: "transparent", color: "var(--text-3)",
            borderRadius: "5px 5px 0 0",
            display: "flex", alignItems: "center",
            cursor: "pointer", flexShrink: 0,
          }}>
          <Plus size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

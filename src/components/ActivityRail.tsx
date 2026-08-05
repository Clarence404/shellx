import { useState } from "react";
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
      flexDirection: "column", alignItems: "stretch", gap: 2, padding: "8px 4px",
    }}>
      {ITEMS.map((item) => (
        <RailButton
          key={item.id}
          item={item}
          active={activeView === item.id}
          onClick={() => (activeView === item.id ? toggleDrawer() : setView(item.id))}
        />
      ))}
    </nav>
  );
}

function RailButton({ item, active, onClick }: {
  item: { id: RailView; label: string; Icon: LucideIcon };
  active: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const { label, Icon } = item;
  // Colour precedence: active > hover > idle. Hover uses --border (a subtle
  // tint) rather than --accent so only ONE button reads as "selected" at a
  // time.
  const bg = active ? "var(--accent)" : (hover ? "var(--border)" : "transparent");
  const fg = active ? "var(--text-on-accent)" : "var(--text-2)";
  return (
    <button
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 2,
        padding: "6px 2px", borderRadius: 5,
        background: bg, color: fg,
        cursor: "pointer", border: "none",
        transition: "background 120ms ease",
      }}>
      <Icon size={18} strokeWidth={1.8} />
      <span style={{
        fontSize: 10, lineHeight: 1.1, letterSpacing: 0.2,
        // Never wrap the label — long labels get an ellipsis instead of
        // pushing the icon out of vertical centre.
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        maxWidth: "100%",
      }}>{label}</span>
    </button>
  );
}

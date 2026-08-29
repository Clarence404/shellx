import { useState } from "react";
import { Server, Files, Waypoints, Cable, Settings, type LucideIcon, ArrowDownUp } from "lucide-react";
import { useSessions, type RailView } from "../state/sessions";
import { useT } from "../i18n";
import { useUpdater } from "../state/updater";

export type { RailView };

// Primary items live in the top cluster; footer items (Settings) sit at
// the bottom of the rail so they're never confused with feature entries.
const PRIMARY_ITEMS: { id: RailView; label: string; Icon: LucideIcon }[] = [
  { id: "hosts", label: "Hosts", Icon: Server },
  { id: "files", label: "Files", Icon: Files },
  { id: "tunnels", label: "Tunnels", Icon: Waypoints },
  { id: "ftp", label: "FTP", Icon: ArrowDownUp },
  { id: "serial", label: "Serial", Icon: Cable },
];
const FOOTER_ITEMS: { id: RailView; label: string; Icon: LucideIcon }[] = [
  { id: "settings", label: "Settings", Icon: Settings },
];

export function ActivityRail() {
  const activeView = useSessions((s) => s.railView);
  const setView = useSessions((s) => s.setRailView);
  const toggleDrawer = useSessions((s) => s.toggleDrawer);
  const updateAvailable = useUpdater((s) => s.status === "available");
  const renderItem = (item: { id: RailView; label: string; Icon: LucideIcon }) => (
    <RailButton
      key={item.id}
      item={item}
      active={activeView === item.id}
      onClick={() => (activeView === item.id ? toggleDrawer() : setView(item.id))}
      showDot={item.id === "settings" && updateAvailable}
    />
  );
  return (
    <nav aria-label="activity rail" style={{
      width: "var(--rail-w)", flexShrink: 0, background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", display: "flex",
      flexDirection: "column", alignItems: "stretch", gap: 2, padding: "8px 4px",
    }}>
      {PRIMARY_ITEMS.map(renderItem)}
      <div style={{ flex: 1 }} />
      {FOOTER_ITEMS.map(renderItem)}
    </nav>
  );
}

function RailButton({ item, active, onClick, showDot = false }: {
  item: { id: RailView; label: string; Icon: LucideIcon };
  active: boolean;
  onClick: () => void;
  showDot?: boolean;
}) {
  const t = useT();
  const [hover, setHover] = useState(false);
  const { label, Icon } = item;
  // Colour precedence: active > hover > idle. Hover uses --border (a subtle
  // tint) rather than --accent so only ONE button reads as "selected" at a
  // time.
  const bg = active ? "var(--accent)" : (hover ? "var(--border)" : "transparent");
  // Idle labels render at (ui - 2px) — too small to carry plain --text-2
  // legibly, so mix toward --text-1 while staying dimmer than the active
  // button. Hover goes full --text-1.
  const fg = active
    ? "var(--text-on-accent)"
    : hover
    ? "var(--text-1)"
    : "color-mix(in srgb, var(--text-1) 60%, var(--text-2))";
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
      <div style={{ position: "relative", display: "flex" }}>
        <Icon size={18} strokeWidth={1.8} />
        {showDot && <span style={{
          position: "absolute", top: -2, right: -4, width: 7, height: 7,
          borderRadius: "50%", background: "var(--error)",
          border: "1.5px solid var(--panel-1)",
        }} />}
      </div>
      <span style={{
        // Follows the System font size slider — 2 px smaller than the
        // main chrome so the rail can pack four labels in 64 px width.
        // Long labels get an ellipsis at high sizes rather
        // than pushing the icon out of vertical centre.
        fontSize: "calc(var(--font-ui-size) - 2px)",
        lineHeight: 1.1, letterSpacing: 0.2,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        maxWidth: "100%",
      }}>{t(label)}</span>
    </button>
  );
}

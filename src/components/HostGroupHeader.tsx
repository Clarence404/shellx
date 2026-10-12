import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { HostContextMenu, type MenuItem } from "./HostContextMenu";
import { splitHighlight } from "../state/hostGroups";
import { useT } from "../i18n";

interface Props {
  name: string;
  total: number;
  online: number;
  open: boolean;
  /** The active search, for highlighting a name hit. */
  query: string;
  onToggle: () => void;
  onRename: () => void;
  onDissolve: () => void;
}

/** One group's header row: a collapse toggle with the name and a
 *  "total · N online" count, plus a right-click menu to rename or dissolve. */
export function HostGroupHeader({ name, total, online, open, query, onToggle, onRename, onDissolve }: Props) {
  const t = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const items: MenuItem[] = [
    { label: t("Rename group"), onClick: onRename },
    { label: t("Dissolve group"), onClick: onDissolve, variant: "danger" },
  ];

  return (
    <>
      <button
        aria-expanded={open}
        aria-label={name}
        title={t("Right-click to rename or dissolve")}
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          padding: "6px 6px", marginTop: 4, borderRadius: 5,
          background: "transparent", color: "var(--text-2)", textAlign: "left",
          fontSize: "calc(var(--font-ui-size) - 1px)", fontWeight: 600,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--panel-2)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <ChevronDown
          size={13} strokeWidth={2.2}
          style={{
            flexShrink: 0, color: "var(--text-3)",
            transform: open ? undefined : "rotate(-90deg)", transition: "transform 0.12s",
          }}
        />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {splitHighlight(name, query).map((seg, i) =>
            seg.hit ? <mark key={i} style={markStyle}>{seg.text}</mark> : <span key={i}>{seg.text}</span>)}
        </span>
        <span style={{ flexShrink: 0, fontWeight: 400, fontSize: 11, color: "var(--text-3)" }}>
          {total}
          {online > 0 && (
            <span style={{ color: "var(--success)", fontWeight: 500 }}> · {online} {t("online")}</span>
          )}
        </span>
      </button>
      {menu && (
        <HostContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
    </>
  );
}

export const markStyle = {
  background: "rgba(255, 196, 0, 0.35)", color: "inherit", borderRadius: 2, padding: "0 1px",
} as const;

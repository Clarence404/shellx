import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Menu content model. Backwards-compatible with the original flat list
 * shape (an object with just `label` + `onClick` renders as a clickable
 * row), and additionally supports:
 * - `kind: "separator"` — a 0.5 px divider between item groups
 * - `kind: "section"` — a small-caps subheading (no click) to label a
 *   group. Used by the file-row context menu (v0.5.6) to split
 *   file-scope actions (Download/Rename/Delete) from folder-scope
 *   actions (New folder/Upload/Refresh).
 * - `icon` — optional leading icon (any ReactNode; typically a lucide
 *   `<Icon size={12} />`).
 */
export type MenuItem =
  | {
      kind?: "item";
      label: string;
      onClick: () => void;
      variant?: "danger";
      icon?: ReactNode;
    }
  | { kind: "separator" }
  | { kind: "section"; label: string };

export function HostContextMenu({
  x, y, items, onClose,
}: {
  x: number; y: number; items: MenuItem[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Anchor at the requested (x, y) first, then flip on the next paint if
  // the measured menu would spill past the viewport. Rendered
  // opacity: 0 on the first paint to avoid a visible jump from
  // anchor → adjusted position.
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: y, left: x });
  const [measured, setMeasured] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 4;
    let top = y;
    let left = x;
    if (top + rect.height > vh - margin) top = Math.max(margin, y - rect.height);
    if (left + rect.width > vw - margin) left = Math.max(margin, x - rect.width);
    setPos({ top, left });
    setMeasured(true);
  }, [x, y]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" style={{
      position: "fixed", top: pos.top, left: pos.left,
      background: "var(--panel-2)", border: "1px solid var(--border)",
      borderRadius: 5, padding: 4, zIndex: 200,
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      minWidth: 160,
      opacity: measured ? 1 : 0,
    }}>
      {items.map((item, i) => {
        if ("kind" in item && item.kind === "separator") {
          return (
            <div key={`sep-${i}`} style={{
              height: "0.5px", background: "var(--border)",
              margin: "4px 2px",
            }} />
          );
        }
        if ("kind" in item && item.kind === "section") {
          return (
            <div key={`sec-${i}`} style={{
              padding: "4px 10px 2px", fontSize: 10,
              color: "var(--text-3)", fontWeight: 500,
              textTransform: "uppercase", letterSpacing: 0.8,
            }}>{item.label}</div>
          );
        }
        // item (default kind)
        return (
          <button
            key={`it-${i}`}
            role="menuitem"
            onClick={() => { item.onClick(); onClose(); }}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              width: "100%", padding: "5px 10px",
              fontSize: "var(--font-ui-size)", textAlign: "left",
              color: item.variant === "danger" ? "var(--error)" : "var(--text-1)",
              borderRadius: 3,
              background: "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--border)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {item.icon && (
              <span style={{
                display: "inline-flex", alignItems: "center",
                color: item.variant === "danger" ? "var(--error)" : "var(--text-2)",
              }}>{item.icon}</span>
            )}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

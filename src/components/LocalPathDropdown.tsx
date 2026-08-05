import { useEffect, useRef, useState } from "react";
import { Folder, ChevronDown } from "lucide-react";
import { localDefaultRoots } from "../ipc/local";
import { useIconSizes } from "../state/settings";
import type { DefaultRoots } from "../types/local";

interface Props {
  currentPath: string;
  onSelect: (path: string) => void;
}

export function LocalPathDropdown({ currentPath, onSelect }: Props) {
  const iconSizes = useIconSizes();
  const [open, setOpen] = useState(false);
  const [roots, setRoots] = useState<DefaultRoots | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => { void localDefaultRoots().then(setRoots); }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Label is intentionally a role, not the current path — the breadcrumb
  // below already shows where you are. This button says where you can go.
  const label = displayLabel(currentPath, roots) ?? "Local";

  const items: { label: string; path: string }[] = [];
  if (roots) {
    items.push({ label: "~ Home", path: roots.home });
    if (roots.desktop) items.push({ label: "Desktop", path: roots.desktop });
    if (roots.downloads) items.push({ label: "Downloads", path: roots.downloads });
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {/* Fixed padding, not var(--pad-row-y/x): this is toolbar chrome (parent
          LocalPane/RemotePane rows are a fixed 32px tall), not a scrollable
          list row — it must not grow with density. At spacious density,
          iconSizes.md (17) + 2*--pad-row-y (9) + 2px border == 37px, which
          overflows the 32px toolbar. Only the popover's <li> rows below are
          density-scaled. */}
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox" aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px",
          fontSize: "var(--font-small)", color: "var(--text-1)", background: "var(--panel-1)",
          border: "1px solid var(--border)", borderRadius: 5,
          fontFamily: "\"JetBrains Mono\", var(--font-mono)",
        }}>
        <Folder size={iconSizes.md} color="var(--text-2)" />
        <span>{label}</span>
        <ChevronDown size={iconSizes.sm} color="var(--text-3)" />
      </button>
      {open && (
        <ul ref={listRef} role="listbox"
          style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4,
            minWidth: 180, background: "var(--panel-2)",
            border: "0.5px solid var(--border)", borderRadius: 6,
            padding: 4, zIndex: 100, listStyle: "none",
          }}>
          {items.map((it) => (
            <li key={it.path} role="option"
              onClick={() => { onSelect(it.path); setOpen(false); }}
              style={{
                padding: "var(--pad-row-y) var(--pad-row-x)", fontSize: "var(--font-small)", color: "var(--text-1)",
                cursor: "pointer", borderRadius: 4,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--border)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >{it.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function displayLabel(current: string, roots: DefaultRoots | null): string | null {
  if (!roots) return null;
  if (current === roots.home) return "~ Home";
  if (current === roots.desktop) return "Desktop";
  if (current === roots.downloads) return "Downloads";
  return null;
}

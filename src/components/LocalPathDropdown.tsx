import { useEffect, useRef, useState } from "react";
import { Folder, ChevronDown } from "lucide-react";
import { localDefaultRoots } from "../ipc/local";
import type { DefaultRoots } from "../types/local";

interface Props {
  currentPath: string;
  onSelect: (path: string) => void;
}

export function LocalPathDropdown({ currentPath, onSelect }: Props) {
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

  const label = displayLabel(currentPath, roots) ?? (currentPath || "Local");

  const items: { label: string; path: string }[] = [];
  if (roots) {
    items.push({ label: "~ Home", path: roots.home });
    if (roots.desktop) items.push({ label: "Desktop", path: roots.desktop });
    if (roots.downloads) items.push({ label: "Downloads", path: roots.downloads });
  }
  // If currentPath isn't one of the roots, show it as "Current" at bottom
  if (currentPath && !items.some(it => it.path === currentPath)) {
    items.push({ label: `Current · ${currentPath}`, path: currentPath });
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox" aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
          fontSize: 11, color: "var(--text-1)", background: "var(--panel-1)",
          border: "0.5px solid var(--border)", borderRadius: 5,
          fontFamily: "\"JetBrains Mono\", var(--font-mono)",
        }}>
        <Folder size={12} color="var(--text-2)" />
        <span>{label}</span>
        <ChevronDown size={11} color="var(--text-3)" />
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
                padding: "6px 10px", fontSize: 11, color: "var(--text-1)",
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

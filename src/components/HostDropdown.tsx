import { useEffect, useRef, useState } from "react";
import { Server, ChevronDown, Plus } from "lucide-react";
import { useSessions } from "../state/sessions";

interface Props {
  currentHost: string | null;
  onSelect: (id: string | null) => void;
  onNewConnection: () => void;
}

export function HostDropdown({ currentHost, onSelect, onNewConnection }: Props) {
  const sessions = useSessions((s) => s.sessions);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
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

  const active = sessions.find((s) => s.id === currentHost);
  const label = active?.label ?? "Pick a host";

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
        <Server size={12} color="var(--text-2)" />
        <span>{label}</span>
        <ChevronDown size={11} color="var(--text-3)" />
      </button>
      {open && (
        <ul ref={listRef} role="listbox" style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          minWidth: 200, background: "var(--panel-2)",
          border: "0.5px solid var(--border)", borderRadius: 6,
          padding: 4, zIndex: 100, listStyle: "none",
        }}>
          {sessions.length === 0 && (
            <li style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-3)" }}>
              No connections yet
            </li>
          )}
          {sessions.map((s) => (
            <li key={s.id} role="option"
              onClick={() => { onSelect(s.id); setOpen(false); }}
              style={{
                padding: "6px 10px", fontSize: 11, color: "var(--text-1)",
                cursor: "pointer", borderRadius: 4,
                display: "flex", alignItems: "center", gap: 6,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--border)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%",
                background: "var(--accent)", opacity: s.state === "active" ? 1 : 0.3 }} />
              {s.label}
            </li>
          ))}
          <li role="option"
            onClick={() => { onNewConnection(); setOpen(false); }}
            style={{
              padding: "6px 10px", fontSize: 11, color: "var(--text-1)",
              cursor: "pointer", borderRadius: 4, borderTop: "0.5px solid var(--border)",
              marginTop: 4, display: "flex", alignItems: "center", gap: 6,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--border)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <Plus size={11} /> New connection
          </li>
        </ul>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useHostsStore } from "../state/hosts";
import { Wordmark } from "./Wordmark";
import type { HostInfo } from "../types/host";

interface Props {
  open: boolean;
  onClose: () => void;
  onConnect: (host: HostInfo) => void;
}

export function CommandPalette({ open, onClose, onConnect }: Props) {
  const hosts = useHostsStore((s) => s.hosts);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      // Delay focus to next tick — element may not be in DOM yet on first render
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((h) =>
      h.label.toLowerCase().includes(q) ||
      h.host.toLowerCase().includes(q) ||
      h.username.toLowerCase().includes(q)
    );
  }, [hosts, query]);

  useEffect(() => {
    // Clamp selected index when filtered list changes
    if (selectedIdx >= filtered.length) setSelectedIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, selectedIdx]);

  if (!open) return null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = filtered[selectedIdx];
      if (chosen) {
        onConnect(chosen);
        onClose();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div role="dialog" aria-label="command palette"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", justifyContent: "center", paddingTop: "10vh",
        zIndex: 200,
      }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 320, background: "var(--panel-2)", border: "1px solid var(--border)",
        borderRadius: 8, padding: 8, height: "fit-content",
        boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
      }}>
        <div style={{ padding: "4px 6px 8px", display: "flex", alignItems: "center", gap: 8 }}>
          <Wordmark size="sm" />
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Type to search hosts..."
          style={{
            width: "100%", background: "var(--panel-1)",
            border: "1px solid var(--border)", borderRadius: 4,
            padding: "6px 8px", fontSize: 12, color: "var(--text-1)",
          }} />
        <div style={{ marginTop: 6, maxHeight: 260, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "8px 6px", color: "var(--text-3)", fontSize: 11 }}>
              No matching hosts.
            </div>
          ) : filtered.map((h, i) => (
            <div key={h.id}
              onClick={() => { onConnect(h); onClose(); }}
              style={{
                padding: "6px 8px", borderRadius: 4, fontSize: 12,
                background: i === selectedIdx ? "rgba(124,92,255,0.15)" : "transparent",
                color: "var(--text-1)", cursor: "pointer",
                display: "flex", justifyContent: "space-between",
              }}>
              <span>{h.label}</span>
              <span style={{ color: "var(--text-3)", fontSize: 10,
                fontFamily: '"JetBrains Mono", var(--font-mono)' }}>
                {h.username}@{h.host}:{h.port}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

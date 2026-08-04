import { Plus } from "lucide-react";
import { Wordmark } from "./Wordmark";
import { useHostsStore } from "../state/hosts";

const kbdStyle = {
  background: "var(--border)", padding: "2px 6px",
  borderRadius: 3, color: "var(--text-1)",
  fontFamily: '"JetBrains Mono", var(--font-mono)', fontSize: 10,
} as const;

export function EmptyState({ onNewConnection }: { onNewConnection?: () => void }) {
  const hasHosts = useHostsStore((s) => s.hosts.length > 0);

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 14,
    }}>
      <Wordmark size="lg" />
      <div style={{ fontSize: 12, color: "var(--text-2)" }}>
        A tiny, pretty terminal client.
      </div>
      {hasHosts ? (
        <div style={{
          fontSize: 12, color: "var(--text-3)",
          marginTop: 8, textAlign: "center", lineHeight: 1.7,
        }}>
          Pick a host from the sidebar,<br />
          or press <kbd style={kbdStyle}>⌘K</kbd> to search.
        </div>
      ) : (
        <>
          <button
            onClick={onNewConnection}
            style={{
              marginTop: 6, padding: "8px 18px",
              background: "var(--accent)", color: "var(--text-on-accent)",
              border: "none", borderRadius: 6,
              fontSize: 12, fontWeight: 500,
              display: "inline-flex", alignItems: "center", gap: 6,
              cursor: "pointer",
              boxShadow: "0 4px 14px rgba(124, 92, 255, 0.35)",
            }}>
            <Plus size={12} strokeWidth={2.5} />
            New connection
          </button>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            or press <kbd style={kbdStyle}>⌘K</kbd> to open a saved host
          </div>
        </>
      )}
    </div>
  );
}

import type { RailView } from "./ActivityRail";
export function Drawer({
  view, onNewConnection,
}: { view: RailView; onNewConnection?: () => void }) {
  return (
    <aside aria-label="drawer" style={{
      width: "var(--drawer-w)", background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", padding: "10px 12px",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{
        fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
        color: "var(--text-3)", marginBottom: 8,
      }}>{view}</div>
      <div style={{ flex: 1, fontSize: 12, color: "var(--text-3)", overflow: "auto" }}>
        {view === "hosts" ? "No hosts yet." : null}
      </div>
      {view === "hosts" && onNewConnection && (
        <button onClick={onNewConnection}
          style={{ padding: "6px 8px", borderRadius: 5,
            background: "var(--accent-fade)", color: "var(--text-1)",
            border: "1px solid var(--accent)", fontSize: 12,
          }}>
          ＋ New connection
        </button>
      )}
    </aside>
  );
}

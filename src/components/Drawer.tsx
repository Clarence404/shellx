import type { RailView } from "./ActivityRail";
export function Drawer({ view }: { view: RailView }) {
  return (
    <aside aria-label="drawer" style={{
      width: "var(--drawer-w)", background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", padding: "10px 12px",
      overflow: "auto"
    }}>
      <div style={{
        fontSize: 10, letterSpacing: 1, textTransform: "uppercase",
        color: "var(--text-3)", marginBottom: 8,
      }}>{view}</div>
      {view === "hosts" ? (
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>No hosts yet.</div>
      ) : null}
    </aside>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-2)"
    }}>
      <h2 style={{ color: "var(--text-1)", fontSize: 15, fontWeight: 600 }}>{title}</h2>
      <p style={{ fontSize: 12 }}>{description}</p>
    </div>
  );
}

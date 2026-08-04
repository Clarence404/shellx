interface Props {
  path: string;
  onNavigate: (path: string) => void;
}

export function PathBreadcrumb({ path, onNavigate }: Props) {
  const parts = path.split("/").filter((p) => p.length > 0);
  const paths: { label: string; target: string }[] = [];

  if (parts.length === 0) {
    paths.push({ label: "/", target: "/" });
  } else {
    let acc = "";
    for (const part of parts) {
      acc += "/" + part;
      paths.push({ label: part, target: acc });
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4,
      fontFamily: '"JetBrains Mono", var(--font-mono)', fontSize: 11 }}>
      {paths.map((p, i) => (
        <div key={p.target} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {i > 0 && <span style={{ color: "var(--text-3)" }}>/</span>}
          <button
            onClick={() => onNavigate(p.target)}
            style={{
              color: i === paths.length - 1 ? "var(--text-1)" : "var(--text-2)",
              padding: "2px 4px", borderRadius: 3, cursor: "pointer",
            }}
          >
            {p.label}
          </button>
        </div>
      ))}
    </div>
  );
}

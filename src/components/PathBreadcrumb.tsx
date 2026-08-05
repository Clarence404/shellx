interface Props {
  path: string;
  onNavigate: (path: string) => void;
}

export function PathBreadcrumb({ path, onNavigate }: Props) {
  const parts = path.split("/").filter((p) => p.length > 0);
  const paths: { label: string; target: string }[] = [];

  // Windows drive-letter paths (post-Rust-normalization form `C:/Users/...`)
  // should NOT get a leading "/": `C:` is already an anchored root, and the
  // path `/C:/Users` isn't valid Windows. POSIX absolute paths (/etc, ...)
  // keep the leading "/" — that's what users expect for "/etc" over "etc".
  const isWinDrive = parts.length > 0 && /^[A-Za-z]:$/.test(parts[0]);

  if (parts.length === 0) {
    paths.push({ label: "/", target: "/" });
  } else {
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      // Windows: acc grows as `C:`, `C:/Users`, `C:/Users/chen` (no leading /)
      // POSIX:   acc grows as `/etc`, `/etc/foo`, ... (leading / from prefix)
      acc = i === 0
        ? (isWinDrive ? parts[i] : "/" + parts[i])
        : acc + "/" + parts[i];
      // First segment renders with the same prefix so users see "/etc" not
      // "etc" on POSIX, and "C:" (no slash) on Windows.
      const label = i === 0
        ? (isWinDrive ? parts[i] : "/" + parts[i])
        : parts[i];
      paths.push({ label, target: acc });
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

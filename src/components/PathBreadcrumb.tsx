import { useEffect, useRef } from "react";

interface Props {
  path: string;
  onNavigate: (path: string) => void;
}

export function PathBreadcrumb({ path, onNavigate }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
      // Target special case: a bare "C:" is NOT the drive root on Windows —
      // Rust's canonicalize resolves it to the process cwd (whatever
      // shellx.exe was launched from), so clicking the drive-letter chip
      // would silently jump to `src-tauri/` in dev. Append "/" so the
      // click lands on the actual drive root. Mirrors parentPath's fix in
      // LocalPane.tsx.
      const target = (i === 0 && isWinDrive) ? acc + "/" : acc;
      paths.push({ label, target });
    }
  }

  // Auto-scroll to end whenever `path` changes so the deepest (current)
  // segment is always visible; users can scroll left to see the parents.
  // Matches how modern file managers handle long paths.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [path]);

  return (
    <div
      ref={scrollRef}
      className="shellx-hide-scrollbar"
      onWheel={(e) => {
        const el = scrollRef.current;
        if (!el) return;
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        if (delta === 0) return;
        el.scrollLeft += delta;
      }}
      style={{
        // Grow to fill remaining space in the parent flex row; the
        // toolbar buttons that sit next to us are flexShrink: 0, so
        // whatever's left goes here. minWidth: 0 is what actually lets
        // us shrink below content width and trigger the horizontal scroll
        // (default `min-width: auto` on flex children would keep growing).
        flex: 1, minWidth: 0,
        display: "flex", alignItems: "center", gap: 4,
        fontFamily: '"JetBrains Mono", var(--font-mono)',
        fontSize: "var(--font-small)",
        overflowX: "auto", overflowY: "hidden",
        scrollbarWidth: "none",
      }}
    >
      {paths.map((p, i) => (
        <div key={p.target} style={{
          display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
        }}>
          {i > 0 && <span style={{ color: "var(--text-3)" }}>/</span>}
          <button
            onClick={() => onNavigate(p.target)}
            style={{
              color: i === paths.length - 1 ? "var(--text-1)" : "var(--text-2)",
              padding: "2px 4px", borderRadius: 3, cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {p.label}
          </button>
        </div>
      ))}
    </div>
  );
}

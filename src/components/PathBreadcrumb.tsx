import { useEffect, useRef, useState } from "react";
import { ChevronDown, HardDrive } from "lucide-react";
import type { LocalDisk } from "../types/local";

interface Props {
  path: string;
  onNavigate: (path: string) => void;
  /**
   * Optional: when provided, the first breadcrumb segment (Windows drive
   * letter or POSIX `/`) becomes a dropdown trigger; clicking it opens a
   * popover of disks/volumes instead of navigating. LocalPane passes
   * `localListDisks`; RemotePane omits it (remote SFTP has a single `/`).
   */
  onListDisks?: () => Promise<LocalDisk[]>;
}

export function PathBreadcrumb({ path, onNavigate, onListDisks }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [diskMenu, setDiskMenu] = useState<{ x: number; y: number } | null>(null);
  const [disks, setDisks] = useState<LocalDisk[] | null>(null);

  const parts = path.split("/").filter((p) => p.length > 0);
  const paths: { label: string; target: string }[] = [];

  // Windows drive-letter paths (post-Rust-normalization form `C:/Users/...`)
  // should NOT get a leading "/": `C:` is already an anchored root, and the
  // path `/C:/Users` isn't valid Windows. POSIX absolute paths (/etc, ...)
  // keep the leading "/" — that's what users expect for "/etc" over "etc".
  const isWinDrive = parts.length > 0 && /^[A-Za-z]:$/.test(parts[0]);

  // POSIX absolute paths get a standalone root segment so "/" itself is a
  // click target (jump to root). Windows keeps the `C:` chip as the root.
  const hasPosixRoot = !isWinDrive;

  if (parts.length === 0) {
    paths.push({ label: "/", target: "/" });
  } else {
    if (hasPosixRoot) paths.push({ label: "/", target: "/" });
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      // Windows: acc grows as `C:`, `C:/Users`, `C:/Users/chen` (no leading /)
      // POSIX:   acc grows as `/etc`, `/etc/foo`, ... (leading / from prefix)
      acc = i === 0
        ? (isWinDrive ? parts[i] : "/" + parts[i])
        : acc + "/" + parts[i];
      // Target special case: a bare "C:" is NOT the drive root on Windows —
      // Rust's canonicalize resolves it to the process cwd (whatever
      // shellx.exe was launched from), so clicking the drive-letter chip
      // would silently jump to `src-tauri/` in dev. Append "/" so the
      // click lands on the actual drive root. Mirrors parentPath's fix in
      // LocalPane.tsx.
      const target = (i === 0 && isWinDrive) ? acc + "/" : acc;
      paths.push({ label: parts[i], target });
    }
  }

  // Auto-scroll to end whenever `path` changes so the deepest (current)
  // segment is always visible; users can scroll left to see the parents.
  useEffect(() => {
    if (editing) return;
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [path, editing]);

  // When entering edit mode, focus + select-all so the user can either
  // retype from scratch or click-once-more to place the cursor.
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editing]);

  // Close disk popover on outside click.
  useEffect(() => {
    if (!diskMenu) return;
    const onDoc = () => setDiskMenu(null);
    // Defer one tick so the click that opened us doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDoc); };
  }, [diskMenu]);

  function beginEdit() {
    setDraft(path);
    setEditing(true);
  }

  function commitEdit() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === path) return;
    onNavigate(next);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft("");
  }

  async function openDiskMenu(x: number, y: number) {
    if (!onListDisks) return;
    // Show popover immediately with cached list if present; re-fetch in
    // background so plugged-in drives appear on the next open. Skipping the
    // cache would make the popover feel sluggish on Windows (drives spin up).
    if (disks) setDiskMenu({ x, y });
    try {
      const fresh = await onListDisks();
      setDisks(fresh);
      // If popover already open, keep it open — the fresh list swaps in.
      if (!disks) setDiskMenu({ x, y });
    } catch {
      // If we've never got a list, don't leave the user staring at nothing.
      if (!disks) setDiskMenu(null);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitEdit();
          else if (e.key === "Escape") cancelEdit();
        }}
        // Blur does NOT commit — accidental focus loss (Alt-Tab, click
        // elsewhere) shouldn't jump the pane. Only Enter commits.
        onBlur={cancelEdit}
        style={{
          flex: 1, minWidth: 0,
          background: "var(--panel-2)",
          color: "var(--text-1)",
          border: "1px solid var(--accent)",
          borderRadius: 4,
          padding: "2px 6px",
          fontFamily: '"JetBrains Mono", var(--font-mono)',
          fontSize: "var(--font-small)",
          outline: "none",
        }}
      />
    );
  }

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
      // Single-click on the empty area (padding / gap between the last
      // segment and the right edge) enters edit mode. onClick on the
      // container fires only when nothing inside caught the click first,
      // because segment buttons stopPropagation() below.
      onClick={beginEdit}
      // Double-click on any segment also enters edit mode. Handled on
      // the container via bubbling; segment buttons don't stopPropagation
      // for dblclick.
      onDoubleClick={beginEdit}
      title="Click empty area or double-click a segment to edit path"
      style={{
        flex: 1, minWidth: 0,
        display: "flex", alignItems: "center", gap: 4,
        fontFamily: '"JetBrains Mono", var(--font-mono)',
        fontSize: "var(--font-small)",
        overflowX: "auto", overflowY: "hidden",
        scrollbarWidth: "none",
        // The empty area to the right of the last segment must be
        // clickable — a bare flex row would collapse to content width and
        // clicks outside would miss us. `flex: 1 + minWidth: 0` already
        // gives us that width; `cursor: text` telegraphs the affordance.
        cursor: "text",
      }}
    >
      {paths.map((p, i) => {
        const isFirst = i === 0;
        const isLast = i === paths.length - 1;
        const hasDiskPicker = isFirst && !!onListDisks;
        return (
          <div key={p.target} style={{
            display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
          }}>
            {/* No separator right after the POSIX root chip — it IS the slash. */}
            {i > 0 && !(hasPosixRoot && i === 1) && <span style={{ color: "var(--text-3)" }}>/</span>}
            <button
              onClick={(e) => {
                // Prevent the container's onClick (which starts edit
                // mode) from firing after our segment-navigate.
                e.stopPropagation();
                if (hasDiskPicker) {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  void openDiskMenu(rect.left, rect.bottom + 2);
                } else {
                  onNavigate(p.target);
                }
              }}
              // dblclick on a segment BUBBLES up to the container's
              // onDoubleClick → edit mode. Don't stopPropagation here.
              style={{
                color: isLast ? "var(--text-1)" : "var(--text-2)",
                padding: "2px 4px", borderRadius: 3, cursor: "pointer",
                whiteSpace: "nowrap",
                display: "flex", alignItems: "center", gap: 3,
              }}
            >
              {p.label}
              {hasDiskPicker && (
                <ChevronDown size={10} color="var(--text-3)" style={{ marginLeft: 1 }} />
              )}
            </button>
          </div>
        );
      })}
      {diskMenu && (
        <ul
          role="listbox"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: diskMenu.y, left: diskMenu.x,
            minWidth: 160,
            background: "var(--panel-2)",
            border: "0.5px solid var(--border)",
            borderRadius: 6,
            padding: 4,
            zIndex: 100,
            listStyle: "none",
            margin: 0,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          {(!disks || disks.length === 0) && (
            <li style={{ padding: "6px 10px", color: "var(--text-3)", fontSize: 11 }}>
              No disks
            </li>
          )}
          {disks?.map((d) => (
            <li
              key={d.path}
              role="option"
              onClick={() => {
                setDiskMenu(null);
                onNavigate(d.path);
              }}
              style={{
                padding: "6px 10px",
                fontSize: "var(--font-small)",
                color: "var(--text-1)",
                cursor: "pointer",
                borderRadius: 4,
                display: "flex", alignItems: "center", gap: 8,
                fontFamily: '"JetBrains Mono", var(--font-mono)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--border)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <HardDrive size={13} color="var(--text-2)" />
              <span>{d.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

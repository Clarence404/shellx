import { useEffect } from "react";
import { RefreshCw, FolderPlus } from "lucide-react";
import { useRailFiles } from "../state/railFiles";
import { localOpenInOs, localMkdir, localRename, localRemoveFile, localRemoveDir, localDefaultRoots } from "../ipc/local";
import { LocalPathDropdown } from "./LocalPathDropdown";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { FileRow } from "./FileRow";

function joinPath(cwd: string, name: string): string {
  return cwd === "/" ? `/${name}` : `${cwd}/${name}`;
}

/** True for Windows drive-letter roots: "C:", "D:", ... */
function isDriveLetter(seg: string): boolean {
  return /^[A-Za-z]:$/.test(seg);
}

/**
 * `..` navigation. Rust normalizes paths to forward slashes on Windows
 * (e.g. `C:/Users/chen`), so a naive split-and-rejoin with a leading "/"
 * would produce `/C:/Users` — not a valid Windows path. Detect a
 * drive-letter first segment and rejoin without the leading "/".
 *
 * A bare `C:` (no trailing slash) is NOT the drive root on Windows —
 * `canonicalize("C:")` treats it as "current working directory on drive
 * C" and jumps to whatever process cwd is (e.g. the Tauri dev's
 * src-tauri/ dir). Always append `/` so we get the unambiguous root.
 */
function parentPath(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  const firstIsDrive = isDriveLetter(parts[0]);
  // Already at the drive-letter root ("C:/", or bare "C:") → no-op.
  if (firstIsDrive && parts.length === 1) return firstIsDrive ? parts[0] + "/" : cwd;
  parts.pop();
  if (parts.length === 0) return "/";
  if (isDriveLetter(parts[0])) {
    // One segment left AND it's a drive letter → drive root: append `/`
    // to disambiguate from Windows' "cwd on drive X" legacy semantic.
    return parts.length === 1 ? parts[0] + "/" : parts.join("/");
  }
  return "/" + parts.join("/");
}

export function LocalPane() {
  const leftPath = useRailFiles((s) => s.leftPath);
  const entries = useRailFiles((s) => s.leftEntries);
  const loading = useRailFiles((s) => s.leftLoading);
  const error = useRailFiles((s) => s.leftError);
  const selected = useRailFiles((s) => s.leftSelected);

  // Actions are dispatched via getState() at call time rather than a
  // hook-captured reference, so each invocation always reaches the store's
  // current action (avoids stale closures across store rehydration/testing).
  const setLeftPath = (p: string) => useRailFiles.getState().setLeftPath(p);
  const loadLeft = () => useRailFiles.getState().loadLeft();
  const transfer = (direction: "up" | "down") => useRailFiles.getState().transfer(direction);

  // Initial load: if no leftPath yet, default to home. If a path is already
  // set (e.g. rehydrated from persisted localStorage — only leftPath is
  // persisted, not leftEntries), refresh only when entries are actually
  // empty, so a cold restart still populates the list but pre-seeded entries
  // (e.g. in tests) aren't clobbered by a race against the mount effect.
  useEffect(() => {
    if (leftPath) {
      if (entries.length === 0) void loadLeft();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const roots = await localDefaultRoots();
        if (!cancelled) await useRailFiles.getState().setLeftPath(roots.home);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        height: 32, padding: "0 10px", display: "flex", alignItems: "center", gap: 6,
        background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)",
      }}>
        <LocalPathDropdown currentPath={leftPath} onSelect={setLeftPath} />
        <div style={{ flex: 1 }} />
        <button title="New folder" onClick={async () => {
          const name = prompt("New folder name");
          if (!name) return;
          await localMkdir(joinPath(leftPath, name));
          await loadLeft();
        }} style={{ color: "var(--text-2)" }}>
          <FolderPlus size={12} />
        </button>
        <button title="Refresh" onClick={() => void loadLeft()}
          style={{ color: "var(--text-2)" }}>
          <RefreshCw size={12} />
        </button>
      </div>
      <div style={{ height: 30, padding: "0 10px", display: "flex", alignItems: "center",
        background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)" }}>
        <PathBreadcrumb path={leftPath} onNavigate={setLeftPath} />
      </div>
      <div role="list" style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const src = e.dataTransfer.getData("application/x-shellx-pane");
          if (src === "right") transfer("down");
        }}
      >
        {error && <div style={{ padding: "8px 10px", color: "var(--error)", fontSize: 11 }}>{error}</div>}
        {loading && <div style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: 11 }}>Loading…</div>}
        {leftPath !== "/" && (
          <FileRow
            name=".." kind="directory" size={0}
            onOpen={() => void setLeftPath(parentPath(leftPath))}
            onRename={() => {}} onDelete={() => {}} onDownload={() => {}}
            disabled
          />
        )}
        {entries.map((e) => (
          <div key={e.name} draggable
            onDragStart={(ev) => ev.dataTransfer.setData("application/x-shellx-pane", "left")}
          >
            <FileRow
              name={e.name} kind={e.kind} size={e.size}
              selected={selected.includes(e.name)}
              onClick={(ev) => useRailFiles.getState().toggleSelectLeft(e.name, ev.ctrlKey || ev.metaKey || ev.shiftKey)}
              onOpen={() => {
                if (e.kind === "directory") void setLeftPath(joinPath(leftPath, e.name));
                else void localOpenInOs(joinPath(leftPath, e.name));
              }}
              onRename={async (newName) => {
                if (!newName || newName === e.name) return;
                await localRename(joinPath(leftPath, e.name), joinPath(leftPath, newName));
                await loadLeft();
              }}
              onDelete={async () => {
                if (!confirm(`Delete "${e.name}"?`)) return;
                if (e.kind === "directory") await localRemoveDir(joinPath(leftPath, e.name));
                else await localRemoveFile(joinPath(leftPath, e.name));
                await loadLeft();
              }}
              onDownload={() => transfer("up")}  // "Upload to remote" via context menu label; direction is inferred
            />
          </div>
        ))}
      </div>
    </div>
  );
}

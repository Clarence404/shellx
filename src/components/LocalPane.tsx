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

export function LocalPane() {
  const leftPath = useRailFiles((s) => s.leftPath);
  const entries = useRailFiles((s) => s.leftEntries);
  const loading = useRailFiles((s) => s.leftLoading);
  const error = useRailFiles((s) => s.leftError);

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
      <div role="list" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {error && <div style={{ padding: "8px 10px", color: "var(--error)", fontSize: 11 }}>{error}</div>}
        {loading && <div style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: 11 }}>Loading…</div>}
        {leftPath !== "/" && (
          <FileRow
            name=".." kind="directory" size={0}
            onOpen={() => {
              const parts = leftPath.split(/[\\/]/).filter(Boolean);
              parts.pop();
              void setLeftPath(parts.length ? "/" + parts.join("/") : "/");
            }}
            onRename={() => {}} onDelete={() => {}} onDownload={() => {}}
            disabled
          />
        )}
        {entries.map((e) => (
          <FileRow
            key={e.name}
            name={e.name} kind={e.kind} size={e.size}
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
        ))}
      </div>
    </div>
  );
}

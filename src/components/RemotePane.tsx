import { useEffect } from "react";
import { RefreshCw, FolderPlus, Plus } from "lucide-react";
import { useRailFiles } from "../state/railFiles";
import {
  sftpMkdir, sftpRename, sftpRemoveFile, sftpRemoveDir,
} from "../ipc/sftp";
import { sftpDownload } from "../ipc/transfers";
import { HostDropdown } from "./HostDropdown";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { FileRow } from "./FileRow";

interface Props {
  onNewConnection: () => void;
}

function joinPath(cwd: string, name: string): string {
  return cwd === "/" ? `/${name}` : `${cwd}/${name}`;
}

export function RemotePane({ onNewConnection }: Props) {
  const rightHost = useRailFiles((s) => s.rightHost);
  const rightPath = useRailFiles((s) => s.rightPath);
  const entries = useRailFiles((s) => s.rightEntries);
  const loading = useRailFiles((s) => s.rightLoading);
  const error = useRailFiles((s) => s.rightError);
  const leftPath = useRailFiles((s) => s.leftPath);

  // Actions are dispatched via getState() at call time rather than a
  // hook-captured reference, so each invocation always reaches the store's
  // current action (avoids stale closures across store rehydration/testing).
  // See LocalPane for the precedent.
  const setRightHost = (id: string | null) => useRailFiles.getState().setRightHost(id);
  const setRightPath = (p: string) => useRailFiles.getState().setRightPath(p);
  const loadRight = () => useRailFiles.getState().loadRight();

  // Mount-only rehydration guard: useRailFiles's initial state restores
  // rightHost/rightPath directly from localStorage (bypassing setRightHost
  // entirely), while rightEntries is never persisted and starts empty. On a
  // cold restart with a previously-selected host, that leaves the pane
  // showing a host + path but a permanently empty file list. Fire once on
  // mount to catch that case; the `entries.length === 0 && !loading` guard
  // means it's a no-op whenever setRightHost already populated things (the
  // normal host-switch path still relies solely on setRightHost's own
  // load-on-select, so this does not double-fetch on switches).
  useEffect(() => {
    if (rightHost && entries.length === 0 && !loading) {
      void useRailFiles.getState().loadRight();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!rightHost) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        <div style={{
          height: 32, padding: "0 10px", display: "flex", alignItems: "center",
          background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)",
        }}>
          <HostDropdown currentHost={null} onSelect={setRightHost} onNewConnection={onNewConnection} />
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 12, color: "var(--text-3)" }}>
          <div style={{ fontSize: 12 }}>Pick a host to browse remote files</div>
          <button onClick={onNewConnection}
            style={{
              padding: "6px 12px", borderRadius: 5,
              background: "var(--accent-fade)", border: "0.5px solid var(--accent)",
              color: "var(--text-1)", fontSize: 12, display: "flex",
              alignItems: "center", gap: 6,
            }}>
            <Plus size={12} /> New connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        height: 32, padding: "0 10px", display: "flex", alignItems: "center", gap: 6,
        background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)",
      }}>
        <HostDropdown currentHost={rightHost} onSelect={setRightHost} onNewConnection={onNewConnection} />
        <div style={{ flex: 1 }} />
        <button title="New folder" onClick={async () => {
          const name = prompt("New folder name");
          if (!name) return;
          await sftpMkdir(rightHost, joinPath(rightPath, name));
          await loadRight();
        }} style={{ color: "var(--text-2)" }}>
          <FolderPlus size={12} />
        </button>
        <button title="Refresh" onClick={() => void loadRight()}
          style={{ color: "var(--text-2)" }}>
          <RefreshCw size={12} />
        </button>
      </div>
      <div style={{ height: 30, padding: "0 10px", display: "flex", alignItems: "center",
        background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)" }}>
        <PathBreadcrumb path={rightPath} onNavigate={setRightPath} />
      </div>
      <div role="list" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {error && <div style={{ padding: "8px 10px", color: "var(--error)", fontSize: 11 }}>{error}</div>}
        {loading && <div style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: 11 }}>Loading…</div>}
        {rightPath !== "/" && (
          <FileRow
            name=".." kind="directory" size={0}
            onOpen={() => {
              const parts = rightPath.split("/").filter(Boolean);
              parts.pop();
              void setRightPath(parts.length ? "/" + parts.join("/") : "/");
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
              if (e.kind === "directory") void setRightPath(joinPath(rightPath, e.name));
              else void sftpDownload(rightHost, joinPath(rightPath, e.name), joinPath(leftPath, e.name));
            }}
            onRename={async (newName) => {
              if (!newName || newName === e.name) return;
              await sftpRename(rightHost, joinPath(rightPath, e.name), joinPath(rightPath, newName));
              await loadRight();
            }}
            onDelete={async () => {
              if (!confirm(`Delete "${e.name}"?`)) return;
              if (e.kind === "directory") await sftpRemoveDir(rightHost, joinPath(rightPath, e.name));
              else await sftpRemoveFile(rightHost, joinPath(rightPath, e.name));
              await loadRight();
            }}
            onDownload={() => void sftpDownload(rightHost, joinPath(rightPath, e.name), joinPath(leftPath, e.name))}
          />
        ))}
      </div>
    </div>
  );
}

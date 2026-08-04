import { useEffect, useState } from "react";
import { RefreshCw, Upload, FolderPlus } from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useFilesStore } from "../state/files";
import { sftpMkdir, sftpRename, sftpRemoveFile, sftpRemoveDir } from "../ipc/sftp";
import { sftpUpload, sftpDownload } from "../ipc/transfers";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { FileRow } from "./FileRow";

interface Props {
  connectionId: string;
}

function joinPath(cwd: string, name: string): string {
  return cwd === "/" ? `/${name}` : `${cwd}/${name}`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function FileBrowserView({ connectionId }: Props) {
  const state = useFilesStore((s) => s.perConnection[connectionId]);
  const loadDir = useFilesStore((s) => s.loadDir);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [mkdirName, setMkdirName] = useState("");

  // Initial load for this connection's cwd
  useEffect(() => {
    if (!state) void loadDir(connectionId, ".");
  }, [connectionId, state, loadDir]);

  // Native Tauri drag-drop listener (scoped to this component's lifetime)
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    let unlisten: (() => void) | undefined;
    win.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const cwd = state?.cwd ?? ".";
        for (const localPath of event.payload.paths) {
          const remotePath = joinPath(cwd, basename(localPath));
          void sftpUpload(connectionId, localPath, remotePath);
        }
      }
    }).then((u) => { unlisten = u; });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, state?.cwd]);

  if (!state) {
    return <div style={{ padding: 20, color: "var(--text-3)" }}>Loading…</div>;
  }

  async function handleUploadClick() {
    const selected = await openDialog({ multiple: true, directory: false });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) {
      const remote = joinPath(state.cwd, basename(p));
      void sftpUpload(connectionId, p, remote);
    }
  }

  async function handleDownload(name: string) {
    const savePath = await saveDialog({ defaultPath: name });
    if (!savePath) return;
    const remotePath = joinPath(state.cwd, name);
    void sftpDownload(connectionId, remotePath, savePath);
  }

  async function handleRename(oldName: string, newName: string) {
    if (!newName || newName === oldName) return;
    const from = joinPath(state.cwd, oldName);
    const to = joinPath(state.cwd, newName);
    await sftpRename(connectionId, from, to);
    await loadDir(connectionId, state.cwd);
  }

  async function handleDelete(name: string, isDir: boolean) {
    if (!confirm(`Delete "${name}"?`)) return;
    const path = joinPath(state.cwd, name);
    if (isDir) await sftpRemoveDir(connectionId, path);
    else await sftpRemoveFile(connectionId, path);
    await loadDir(connectionId, state.cwd);
  }

  async function handleMkdirSubmit() {
    const name = mkdirName.trim();
    setCreatingFolder(false);
    setMkdirName("");
    if (!name) return;
    const path = joinPath(state.cwd, name);
    await sftpMkdir(connectionId, path);
    await loadDir(connectionId, state.cwd);
  }

  function goUp() {
    const parts = state.cwd.split("/").filter(Boolean);
    if (parts.length === 0) return;
    parts.pop();
    void loadDir(connectionId, "/" + parts.join("/"));
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{
        height: 32, padding: "0 10px", background: "var(--panel-1)",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <PathBreadcrumb path={state.cwd} onNavigate={(p) => loadDir(connectionId, p)} />
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setCreatingFolder(true)}
          title="New folder"
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-2)" }}
        >
          <FolderPlus size={12} /> New folder
        </button>
        <button onClick={() => loadDir(connectionId, state.cwd)} title="Refresh"
          style={{ display: "flex", alignItems: "center", color: "var(--text-2)" }}>
          <RefreshCw size={12} />
        </button>
        <button onClick={handleUploadClick} style={{
          display: "flex", alignItems: "center", gap: 4, fontSize: 10,
          color: "var(--text-2)",
        }}>
          <Upload size={12} /> Upload
        </button>
      </div>
      <div role="list" style={{ flex: 1, overflow: "auto" }}>
        {state.error && (
          <div style={{ padding: "8px 10px", color: "var(--error)", fontSize: 11 }}>{state.error}</div>
        )}
        {state.loading && (
          <div style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: 11 }}>Loading…</div>
        )}
        {state.cwd !== "/" && (
          <FileRow
            name=".."
            kind="directory"
            size={0}
            onOpen={goUp}
            onRename={() => {}}
            onDelete={() => {}}
            onDownload={() => {}}
            disabled
          />
        )}
        {state.entries.map((entry) => (
          <FileRow
            key={entry.name}
            name={entry.name}
            kind={entry.kind}
            size={entry.size}
            onOpen={() => {
              if (entry.kind === "directory") void loadDir(connectionId, joinPath(state.cwd, entry.name));
              else void handleDownload(entry.name);
            }}
            onRename={(newName) => handleRename(entry.name, newName)}
            onDelete={() => handleDelete(entry.name, entry.kind === "directory")}
            onDownload={() => handleDownload(entry.name)}
          />
        ))}
        {creatingFolder && (
          <div style={{ padding: "6px 10px", display: "flex", gap: 6 }}>
            <input
              autoFocus
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleMkdirSubmit();
                else if (e.key === "Escape") { setCreatingFolder(false); setMkdirName(""); }
              }}
              onBlur={() => void handleMkdirSubmit()}
              placeholder="folder name"
              style={{
                background: "var(--panel-1)", color: "var(--text-1)",
                border: "1px solid var(--accent)", borderRadius: 4,
                padding: "4px 8px", fontSize: 11,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

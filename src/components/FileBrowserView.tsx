import { useEffect, useRef, useState } from "react";
import { RefreshCw, Upload, FolderPlus } from "lucide-react";
import { PaneToolbarButton } from "./PaneToolbarButton";
import { HostContextMenu } from "./HostContextMenu";
import { buildFolderMenuItems, type FolderMenuHandlers } from "./FileRow";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useFilesStore } from "../state/files";
import { sftpMkdir, sftpRename, sftpRemoveFile, sftpRemoveDir, sftpRealpath } from "../ipc/sftp";
import { sftpUpload, sftpDownload, sftpUploadDir, sftpDownloadDir } from "../ipc/transfers";
import { localIsDir } from "../ipc/local";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { FileRow } from "./FileRow";
import { TransferQueue } from "./TransferQueue";
import { TransferStripSection } from "./TransferStripSection";

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
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null);
  // Drop-target highlight — mirrors LocalPane / RemotePane. `paneRef`
  // gives us the CSS-px bounding rect so we can hit-test Tauri's
  // physical-px drag position against this view (not the whole
  // window) and turn the outline on only while the OS cursor is
  // actually over the browser area.
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [osDragOver, setOsDragOver] = useState(false);

  // v0.5.6: Same three folder-scope actions the toolbar exposes, packaged
  // for the file-row + empty-area context menus. Definition kept near the
  // toolbar handlers below (they all close over the same state).
  const folderActions: FolderMenuHandlers = {
    onNewFolder: () => setCreatingFolder(true),
    onUpload: () => void handleUploadClick(),
    onRefresh: () => void loadDir(connectionId, state?.cwd ?? "/"),
  };

  // Initial load: resolve "." to the login shell's home as an absolute path so
  // the breadcrumb, goUp, and joinPath all speak in absolute paths from the
  // start. Without this, the breadcrumb renders "." as target "/." and clicking
  // it jumps to root — the reported bug.
  useEffect(() => {
    if (state) return;
    let cancelled = false;
    (async () => {
      try {
        const home = await sftpRealpath(connectionId, ".");
        if (!cancelled) void loadDir(connectionId, home);
      } catch {
        if (!cancelled) void loadDir(connectionId, "/");
      }
    })();
    return () => { cancelled = true; };
  }, [connectionId, state, loadDir]);

  // Native Tauri drag-drop listener (scoped to this component's lifetime).
  // `cancelled` guards against the async registration race: onDragDropEvent
  // resolves asynchronously, and this effect can be cleaned up (cwd change
  // or unmount) before that promise settles. Without the flag, a listener
  // that resolves after cleanup would wire itself up and never get
  // unsubscribed (cleanup already ran `unlisten?.()` as a no-op) — same
  // leak class as the v0.1 TerminalView fix.
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    win.onDragDropEvent((event) => {
      const el = paneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const inside = (px: number, py: number) => {
        const x = px / dpr, y = py / dpr;
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      };
      const p = event.payload;
      if (p.type === "over") {
        setOsDragOver(inside(p.position.x, p.position.y));
      } else if (p.type === "leave") {
        setOsDragOver(false);
      } else if (p.type === "drop") {
        setOsDragOver(false);
        if (!inside(p.position.x, p.position.y)) return;
        const cwd = state?.cwd ?? ".";
        // Probe each path's kind and route to the recursive IPC for
        // directories. `sftp_upload` on a folder previously failed
        // silently because `LocalFile::open(dir)` errors and `void`
        // discarded the rejection.
        (async () => {
          for (const localPath of p.paths) {
            const remotePath = joinPath(cwd, basename(localPath));
            try {
              const isDir = await localIsDir(localPath);
              if (isDir) {
                await sftpUploadDir(connectionId, localPath, remotePath);
              } else {
                await sftpUpload(connectionId, localPath, remotePath);
              }
            } catch {
              /* one path's failure shouldn't halt the batch */
            }
          }
        })();
      }
    }).then((u) => {
      if (cancelled) {
        u();
        return;
      }
      unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
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

  async function handleDownload(name: string, isDir: boolean) {
    const remotePath = joinPath(state.cwd, name);
    if (isDir) {
      // v0.6 T1: directories go through the recursive Rust IPC. The
      // native save dialog only picks files; ask for a destination
      // directory instead and the remote folder's basename is appended.
      const dstDir = await openDialog({ directory: true, multiple: false });
      if (!dstDir || Array.isArray(dstDir)) return;
      void sftpDownloadDir(connectionId, remotePath, joinPath(dstDir, name));
      return;
    }
    const savePath = await saveDialog({ defaultPath: name });
    if (!savePath) return;
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
    <div
      ref={paneRef}
      style={{
        height: "100%", minHeight: 0, display: "flex", flexDirection: "column",
        // Purple dashed outline while a file is dragged in from
        // Explorer / Finder — matches the LocalPane / RemotePane
        // affordance so the drop target is obvious.
        outline: osDragOver ? "2px dashed var(--accent)" : "none",
        outlineOffset: -2,
        transition: "outline-color 120ms ease",
      }}
    >
      <div style={{
        height: 32, padding: "0 10px", background: "var(--panel-1)",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <PathBreadcrumb path={state.cwd} onNavigate={(p) => loadDir(connectionId, p)} />
        <PaneToolbarButton
          title="New folder"
          onClick={() => setCreatingFolder(true)}>
          {(size) => <FolderPlus size={size} />}
        </PaneToolbarButton>
        <PaneToolbarButton title="Refresh"
          onClick={() => loadDir(connectionId, state.cwd)}>
          {(size) => <RefreshCw size={size} />}
        </PaneToolbarButton>
        <PaneToolbarButton
          title="Upload"
          onClick={handleUploadClick}>
          {(size) => <Upload size={size} />}
        </PaneToolbarButton>
      </div>
      <div role="list" style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        onContextMenu={(e) => {
          // Empty-area right-click: FileRow.handleContextMenu stops
          // propagation, so this only fires on the scroll container
          // itself (background between/below rows).
          e.preventDefault();
          setBlankMenu({ x: e.clientX, y: e.clientY });
        }}
      >
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
              else void handleDownload(entry.name, false);
            }}
            onRename={(newName) => handleRename(entry.name, newName)}
            onDelete={() => handleDelete(entry.name, entry.kind === "directory")}
            onDownload={() => handleDownload(entry.name, entry.kind === "directory")}
            folderActions={folderActions}
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
      {/* Shared strip section — same drag handle + auto-compact vs
          user-height behavior as RailFilesView. State lives in
          `useRailFiles` so a height dragged in one view carries
          over to the other. */}
      <TransferStripSection connectionId={connectionId} />
      {blankMenu && (
        <HostContextMenu
          x={blankMenu.x} y={blankMenu.y}
          items={buildFolderMenuItems(folderActions)}
          onClose={() => setBlankMenu(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { RefreshCw, FolderPlus } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRailFiles } from "../state/railFiles";
import { useSessions } from "../state/sessions";
import { localOpenInOs, localMkdir, localRename, localRemoveFile, localRemoveDir, localDefaultRoots, localCopyInto } from "../ipc/local";
import { sftpUpload, sftpDownload } from "../ipc/transfers";
import { LocalPathDropdown } from "./LocalPathDropdown";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { FileRow, buildFolderMenuItems, type FolderMenuHandlers } from "./FileRow";
import { PaneToolbarButton } from "./PaneToolbarButton";
import { HostContextMenu } from "./HostContextMenu";

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
  const rightHost = useRailFiles((s) => s.rightHost);
  const rightPath = useRailFiles((s) => s.rightPath);
  const sessions = useSessions((s) => s.sessions);
  // Remote is "usable as upload target" only when its session is active.
  // Otherwise `Send to remote` gets hidden — no valid destination.
  const remoteConnected = !!rightHost &&
    !!sessions.find((s) => s.id === rightHost && s.state === "active");
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [osDragOver, setOsDragOver] = useState(false);
  // Highlight when the cross-pane internal drag is hovering over us.
  const internalDragOver = useRailFiles((s) =>
    s.currentDrag?.pane === "right" && s.currentDrag.hoverTarget === "left",
  );
  const dropHighlight = osDragOver || internalDragOver;
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null);
  // v0.5.7: replaces the browser-native prompt() with an inline input
  // row rendered at the top of the file list (matches FileBrowserView).
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [mkdirName, setMkdirName] = useState("");

  // Actions are dispatched via getState() at call time rather than a
  // hook-captured reference, so each invocation always reaches the store's
  // current action (avoids stale closures across store rehydration/testing).
  const setLeftPath = (p: string) => useRailFiles.getState().setLeftPath(p);
  const loadLeft = () => useRailFiles.getState().loadLeft();
  const transfer = (direction: "up" | "down") => useRailFiles.getState().transfer(direction);

  async function submitMkdir() {
    const name = mkdirName.trim();
    setCreatingFolder(false);
    setMkdirName("");
    if (!name) return;
    await localMkdir(joinPath(leftPath, name));
    await loadLeft();
  }

  // Folder-scope actions shared between the toolbar buttons and the
  // right-click menus (empty-area + per-row). "Upload here" for the
  // Local side reuses transfer("down") — pull from remote pane's
  // selection down into this local folder. If no remote pane is
  // connected or nothing is selected there, transfer is a no-op.
  // LocalPane's folder-scope menu drops `onUpload` — "upload to
  // *here*" doesn't make sense for a local pane. Transfer between
  // panes happens via drag-drop or the central ⇄ splitter button.
  const folderActions: FolderMenuHandlers = {
    onNewFolder: () => {
      setMkdirName("");
      setCreatingFolder(true);
    },
    onRefresh: () => void loadLeft(),
  };

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

  // v0.5.7: unified drag-drop via Tauri's onDragDropEvent — handles
  // BOTH OS drops (paths.length > 0) AND internal pane-to-pane drags
  // (paths.length === 0, currentDrag in the store). HTML5 DataTransfer
  // was unreliable across WebView2 + dragDropEnabled: true on Windows.
  useEffect(() => {
    if (!leftPath) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const win = getCurrentWindow();
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
        if (p.paths && p.paths.length > 0) {
          // OS files dropped in — copy each into leftPath.
          (async () => {
            for (const srcPath of p.paths) {
              try { await localCopyInto(srcPath, leftPath); }
              catch { /* one file's failure shouldn't halt the batch */ }
            }
            await loadLeft();
          })();
        } else {
          // Internal pane-to-pane drag from RemotePane.
          const drag = useRailFiles.getState().currentDrag;
          useRailFiles.getState().setCurrentDrag(null);
          if (drag && drag.pane === "right" && rightHost) {
            void sftpDownload(rightHost, joinPath(rightPath, drag.name), joinPath(leftPath, drag.name));
          }
        }
      }
    }).then((u) => {
      if (cancelled) { u(); return; }
      unlisten = u;
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [leftPath, rightHost, rightPath]);

  return (
    <div
      ref={paneRef}
      data-pane="left"
      style={{
        display: "flex", flexDirection: "column", height: "100%", minHeight: 0,
        // Purple dashed outline when either an OS drag is over this
        // pane OR a cross-pane internal drag from the right pane is
        // hovering here — same visual for both drop pathways.
        outline: dropHighlight ? "2px dashed var(--accent)" : "none",
        outlineOffset: -2,
        transition: "outline-color 120ms ease",
        // File manager convention — file rows aren't text-selectable
        // (Explorer/Finder don't let you highlight names either). Also
        // prevents the browser from starting a text-range selection
        // mid-drag, which produced the blue "selected paragraph" look.
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div style={{
        height: 32, padding: "0 10px", display: "flex", alignItems: "center", gap: 6,
        background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)",
      }}>
        <LocalPathDropdown currentPath={leftPath} onSelect={setLeftPath} />
        <div style={{ flex: 1 }} />
        <PaneToolbarButton title="New folder" onClick={() => {
          setMkdirName("");
          setCreatingFolder(true);
        }}>
          {(size) => <FolderPlus size={size} />}
        </PaneToolbarButton>
        <PaneToolbarButton title="Refresh" onClick={() => void loadLeft()}>
          {(size) => <RefreshCw size={size} />}
        </PaneToolbarButton>
      </div>
      <div style={{ height: 30, padding: "0 10px", display: "flex", alignItems: "center",
        background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)" }}>
        <PathBreadcrumb path={leftPath} onNavigate={setLeftPath} />
      </div>
      <div role="list" style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        // outer paneRef div now owns the drop handler; inner list
        // just needs to be visually scrollable + allow context menu
        onContextMenu={(e) => {
          // Empty-area right-click. FileRow.handleContextMenu stops
          // propagation, so this only fires on background between/below
          // rows.
          e.preventDefault();
          setBlankMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {error && <div style={{ padding: "8px 10px", color: "var(--error)", fontSize: 11 }}>{error}</div>}
        {loading && <div style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: 11 }}>Loading…</div>}
        {creatingFolder && (
          <div style={{ padding: "6px 10px", display: "flex", gap: 6 }}>
            <input
              autoFocus
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitMkdir();
                else if (e.key === "Escape") { setCreatingFolder(false); setMkdirName(""); }
              }}
              onBlur={() => void submitMkdir()}
              placeholder="folder name"
              style={{
                flex: 1, background: "var(--panel-1)", color: "var(--text-1)",
                border: "1px solid var(--accent)", borderRadius: 4,
                padding: "4px 8px", fontSize: "var(--font-body)",
                fontFamily: '"JetBrains Mono", var(--font-mono)',
              }}
            />
          </div>
        )}
        {leftPath !== "/" && (
          <FileRow
            name=".." kind="directory" size={0}
            onOpen={() => void setLeftPath(parentPath(leftPath))}
            onRename={() => {}} onDelete={() => {}} onDownload={() => {}}
            disabled
          />
        )}
        {entries.map((e) => (
          <div key={e.name}
            // v0.5.7: mouse-based drag instead of HTML5 drag.
            // WebView2 + Tauri's dragDropEnabled: true refuses to fire
            // internal HTML5 drop events reliably. We track mousedown
            // → move-past-threshold → mouseup by hand via global
            // document listeners installed only for the duration of
            // this specific drag; the dispatch (upload/download) is
            // decided by hit-testing elementFromPoint against
            // [data-pane] at mouseup.
            onMouseDown={(ev) => {
              if (ev.button !== 0) return;
              // Belt-and-suspenders: user-select: none on the outer
              // pane handles most cases, but preventDefault here
              // stops the browser from claiming the mousedown for
              // any residual native drag / selection behaviour.
              ev.preventDefault();
              const startX = ev.clientX, startY = ev.clientY;
              let dragging = false;
              const onMove = (me: MouseEvent) => {
                if (!dragging) {
                  if (Math.hypot(me.clientX - startX, me.clientY - startY) < 5) return;
                  dragging = true;
                  document.body.style.cursor = "grabbing";
                }
                // Continuously update cursor position + which pane is
                // under it. The pane component reads `hoverTarget` to
                // draw a drop-target outline; the ghost follows x/y.
                const el = document.elementFromPoint(me.clientX, me.clientY);
                const paneAttr = el?.closest("[data-pane]")?.getAttribute("data-pane");
                const hoverTarget = paneAttr === "left" || paneAttr === "right" ? paneAttr : null;
                useRailFiles.getState().setCurrentDrag({
                  pane: "left", name: e.name,
                  x: me.clientX, y: me.clientY,
                  hoverTarget,
                });
              };
              const onUp = (up: MouseEvent) => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.body.style.cursor = "";
                if (!dragging) return;
                const drag = useRailFiles.getState().currentDrag;
                useRailFiles.getState().setCurrentDrag(null);
                if (!drag) return;
                const el = document.elementFromPoint(up.clientX, up.clientY);
                const pane = el?.closest("[data-pane]")?.getAttribute("data-pane");
                const st = useRailFiles.getState();
                if (drag.pane === "left" && pane === "right" && st.rightHost) {
                  void sftpUpload(st.rightHost, joinPath(st.leftPath, drag.name), joinPath(st.rightPath, drag.name));
                }
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            }}
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
              // No onDownload — "download a local file" has no
              // meaning. onSendToRemote is the symmetric per-row
              // affordance (Send to remote → context menu item),
              // gated on RemotePane having an active session.
              onSendToRemote={remoteConnected && e.kind !== "directory" ? () => {
                void sftpUpload(
                  rightHost!,
                  joinPath(leftPath, e.name),
                  joinPath(rightPath, e.name),
                );
              } : undefined}
              folderActions={folderActions}
            />
          </div>
        ))}
      </div>
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

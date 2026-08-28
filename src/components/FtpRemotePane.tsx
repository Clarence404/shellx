import { useEffect, useRef, useState } from "react";
import { FolderPlus, RefreshCw } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRailFiles } from "../state/railFiles";
import { ConnectingPanel } from "./ConnectingPanel";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { PaneToolbarButton } from "./PaneToolbarButton";
import { FileRow, buildFolderMenuItems } from "./FileRow";
import { HostContextMenu } from "./HostContextMenu";
import { joinPath, useFtpStore } from "../state/ftp";
import { ftpDownload, ftpDownloadDir } from "../ipc/ftp";
import { dragOutRemote } from "../dragOut";
import { useT } from "../i18n";
import type { FtpEntry, FtpHost } from "../types/ftp";

/** Directories first, then by name — the order every file manager uses,
 *  and the one the server does not promise. */
function sortEntries(entries: FtpEntry[]): FtpEntry[] {
  return [...entries].sort((a, b) => {
    const da = a.kind === "directory" ? 0 : 1;
    const db = b.kind === "directory" ? 0 : 1;
    return da !== db ? da - db : a.name.localeCompare(b.name);
  });
}

/**
 * The remote half of the FTP view. Deliberately the same chrome the
 * Files view uses — toolbar, breadcrumb, and `FileRow` for every row —
 * so a directory looks the same whichever protocol fetched it. What is
 * different is the tag strip in the toolbar, because what a connection
 * is actually doing is the thing FTP makes hard to know.
 */
export function FtpRemotePane() {
  const t = useT();
  const activeId = useFtpStore((s) => s.activeId);
  const hosts = useFtpStore((s) => s.hosts);
  const connected = useFtpStore((s) => s.connected);
  const connecting = useFtpStore((s) => s.connecting);
  const cwd = useFtpStore((s) => s.cwd);
  const entries = useFtpStore((s) => s.entries);
  const listedKey = useFtpStore((s) => s.listedKey);
  const listing = useFtpStore((s) => s.listing);
  const error = useFtpStore((s) => s.error);
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number } | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const [osDragOver, setOsDragOver] = useState(false);
  // The internal drag ghost + hover state live in useRailFiles — shared
  // with LocalPane on purpose, since a drag crosses both panes.
  const internalDragOver = useRailFiles((s) =>
    s.currentDrag?.pane === "left" && s.currentDrag.hoverTarget === "right",
  );

  const host = hosts.find((h) => h.id === activeId) ?? null;
  const live = !!activeId && connected.includes(activeId);

  // OS files dropped onto this pane upload into the directory on screen.
  // Same Tauri listener the Files view uses — HTML5 drag events are
  // unreliable under WebView2.
  useEffect(() => {
    if (!live) return;
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
          const st = useFtpStore.getState();
          for (const localPath of p.paths) {
            const name = localPath.split(/[\\/]/).pop() || "unknown";
            void st.upload(localPath, name, "unknown");
          }
        }
      }
    }).then((u) => {
      if (cancelled) { u(); return; }
      unlisten = u;
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [live]);

  // Landing on a connection with nothing listed yet — after a reconnect,
  // or after the view was remounted — fills the pane without the user
  // having to press refresh. Keyed on what has been listed, not on how
  // many rows came back: an empty directory is an answer, and asking
  // again because it was empty would never stop.
  useEffect(() => {
    if (live && !listing && listedKey !== `${activeId}:${cwd}`) {
      void useFtpStore.getState().refresh();
    }
  }, [live, listing, listedKey, activeId, cwd]);

  const store = useFtpStore.getState;

  async function newFolder() {
    const name = prompt(t("New folder name"));
    if (!name) return;
    await store().mkdir(joinPath(cwd, name));
  }

  const folderActions = {
    onNewFolder: () => void newFolder(),
    onRefresh: () => void store().refresh(),
  };

  // Same panel the Hosts view shows while a connection is being made, so
  // the two views do not have their own idea of what connecting looks like.
  if (host && !!activeId && connecting.includes(activeId)) {
    return (
      <ConnectingPanel
        hostLabel={host.label}
        // The default subtitle names the SSH session, which is only true
        // for one of the three protocols this view speaks.
        subtitle={host.protocol === "sftp"
          ? t("Establishing the SSH session.")
          : t("Opening the control connection.")}
      />
    );
  }

  if (!host || !live) {
    return (
      <div style={{
        height: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 10,
        color: "var(--text-3)", fontSize: 12, padding: 20, textAlign: "center",
      }}>
        {/* A failed connect leaves nothing live, so without this the
            reason would never reach the screen. */}
        {error && (
          <div style={{
            color: "var(--error)", maxWidth: 420, lineHeight: 1.6, whiteSpace: "pre-wrap",
          }}>{error}</div>
        )}
        <div>
          {hosts.length === 0
            ? t("Add an FTP connection to get started")
            : host ? t("Not connected") : t("Pick a connection on the left")}
        </div>
        {host && (
          <button
            type="button"
            onClick={() => void store().connect(host.id)}
            style={{
              padding: "5px 12px", borderRadius: 5, fontSize: 12,
              border: "1px solid var(--accent)", background: "var(--accent-fade)",
              color: "var(--text-1)",
            }}>
            {t("Connect")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={paneRef}
      data-pane="right"
      style={{
        display: "flex", flexDirection: "column", height: "100%", minHeight: 0,
        outline: (osDragOver || internalDragOver) ? "2px dashed var(--accent)" : "none",
        outlineOffset: -2,
        transition: "outline-color 120ms ease",
        userSelect: "none", WebkitUserSelect: "none",
      }}>
      <div style={{
        height: 32, padding: "0 10px", display: "flex", alignItems: "center", gap: 6,
        background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)",
      }}>
        <span style={{
          fontSize: "var(--font-ui-size)", color: "var(--text-1)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{host.label}</span>
        <ConnectionTags host={host} />
        <div style={{ flex: 1 }} />
        <PaneToolbarButton title={t("New folder")} onClick={() => void newFolder()}>
          {(size) => <FolderPlus size={size} />}
        </PaneToolbarButton>
        <PaneToolbarButton title={t("Refresh")} onClick={() => void store().refresh()}>
          {(size) => <RefreshCw size={size} />}
        </PaneToolbarButton>
      </div>

      <div style={{
        height: 30, padding: "0 10px", display: "flex", alignItems: "center",
        background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)",
      }}>
        <PathBreadcrumb path={cwd} onNavigate={(p) => void store().navigate(p)} />
      </div>

      <div
        role="list"
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        onContextMenu={(e) => {
          e.preventDefault();
          setBlankMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {error && (
          <div style={{
            padding: "8px 10px", color: "var(--error)", fontSize: 11, whiteSpace: "pre-wrap",
          }}>{error}</div>
        )}
        {listing && entries.length === 0 && (
          <div style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: 11 }}>
            {t("Loading")}…
          </div>
        )}
        {!listing && entries.length === 0 && !error && (
          <div style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: 11 }}>
            {t("This folder is empty")}
          </div>
        )}
        {cwd !== "" && cwd !== "/" && (
          <FileRow
            name=".." kind="directory" size={0}
            onOpen={() => void store().navigate(joinPath(cwd, ".."))}
            onRename={() => {}} onDelete={() => {}}
            disabled
          />
        )}
        {sortEntries(entries).map((e) => (
          <div key={e.name}
            // Mouse-based drag, same shape as LocalPane's: mousedown →
            // move-past-threshold → mouseup, dispatch decided by which
            // [data-pane] is under the pointer at release.
            onMouseDown={(ev) => {
              if (ev.button !== 0) return;
              ev.preventDefault();
              const startX = ev.clientX, startY = ev.clientY;
              let dragging = false;
              const onMove = (me: MouseEvent) => {
                if (!dragging) {
                  if (Math.hypot(me.clientX - startX, me.clientY - startY) < 5) return;
                  dragging = true;
                  document.body.style.cursor = "grabbing";
                }
                const el = document.elementFromPoint(me.clientX, me.clientY);
                const paneAttr = el?.closest("[data-pane]")?.getAttribute("data-pane");
                useRailFiles.getState().setCurrentDrag({
                  pane: "right", name: e.name,
                  kind: e.kind === "directory" ? "directory" : "file",
                  x: me.clientX, y: me.clientY,
                  hoverTarget: paneAttr === "left" || paneAttr === "right" ? paneAttr : null,
                });
              };
              // Pointer left the window with the button held: stage the
              // file through the queue, then let the OS carry the copy.
              const onOut = (oe: MouseEvent) => {
                if (oe.relatedTarget || !dragging) return;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.removeEventListener("mouseout", onOut);
                document.body.style.cursor = "";
                useRailFiles.getState().setCurrentDrag(null);
                const st = useFtpStore.getState();
                const id = st.activeId;
                if (!id) return;
                const src = joinPath(st.cwd, e.name);
                void dragOutRemote(e.name, async (dest) =>
                  e.kind === "directory"
                    ? (await ftpDownloadDir(id, src, dest)).transferIds
                    : [await ftpDownload(id, src, dest)],
                );
              };
              const onUp = (up: MouseEvent) => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.removeEventListener("mouseout", onOut);
                document.body.style.cursor = "";
                if (!dragging) return;
                const drag = useRailFiles.getState().currentDrag;
                useRailFiles.getState().setCurrentDrag(null);
                if (!drag) return;
                const el = document.elementFromPoint(up.clientX, up.clientY);
                const pane = el?.closest("[data-pane]")?.getAttribute("data-pane");
                if (drag.pane === "right" && pane === "left") {
                  void useFtpStore.getState().download(
                    drag.name, drag.kind, useRailFiles.getState().leftPath,
                  );
                }
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
              document.addEventListener("mouseout", onOut);
            }}
          >
            <FileRow
              name={e.name}
              kind={e.kind}
              size={e.size}
              onOpen={() => {
                if (e.kind === "directory") void store().navigate(joinPath(cwd, e.name));
              }}
              onRename={(next) => void store().rename(joinPath(cwd, e.name), joinPath(cwd, next))}
              onDelete={() => void store().remove(joinPath(cwd, e.name), e.kind === "directory")}
              onDownload={() => void store().download(
                e.name,
                e.kind === "directory" ? "directory" : "file",
                useRailFiles.getState().leftPath,
              )}
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

/** What this connection is actually doing. Nine out of ten FTP problems
 *  are one of these three, so they sit in the toolbar rather than behind
 *  an edit dialog. */
function ConnectionTags({ host }: { host: FtpHost }) {
  const t = useT();
  const tags: { text: string; tone: "warn" | "ok" | "muted" }[] = [];
  tags.push(host.protocol === "ftp"
    ? { text: t("plaintext"), tone: "warn" }
    : { text: t("encrypted"), tone: "ok" });
  if (host.protocol !== "sftp") {
    tags.push({
      text: host.charset === "auto" ? t("auto") : host.charset.toUpperCase(),
      tone: "muted",
    });
    tags.push({ text: host.passive ? t("passive mode") : t("active mode"), tone: "muted" });
  }
  return (
    <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
      {tags.map((tag) => (
        <span key={tag.text} style={{
          fontSize: 9, lineHeight: "15px", padding: "0 4px", borderRadius: 3,
          border: `1px solid ${
            tag.tone === "warn" ? "var(--warn)"
              : tag.tone === "ok" ? "var(--success)" : "var(--border-hi)"}`,
          background: tag.tone === "warn" ? "var(--warn-fade)"
            : tag.tone === "ok" ? "var(--success-fade)" : "transparent",
          color: tag.tone === "warn" ? "var(--warn)"
            : tag.tone === "ok" ? "var(--success)" : "var(--text-3)",
        }}>{tag.text}</span>
      ))}
    </span>
  );
}

import { useEffect, useRef, useState } from "react";
import { FolderPlus, RefreshCw, Server, ChevronDown } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useRailFiles } from "../state/railFiles";
import { ConnectingPanel } from "./ConnectingPanel";
import { PathBreadcrumb } from "./PathBreadcrumb";
import { PaneToolbarButton } from "./PaneToolbarButton";
import { FileRow, buildFolderMenuItems } from "./FileRow";
import { HostContextMenu } from "./HostContextMenu";
import { ErrorDialog } from "./ErrorDialog";
import { joinPath, useFtpStore } from "../state/ftp";
import { ftpDownload, ftpDownloadDir } from "../ipc/ftp";
import { newGesture } from "../ipc/transfers";
import { localIsDir } from "../ipc/local";
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
 * The pane-header connection picker, modeled on the Files view's
 * `HostDropdown`: every saved FTP connection is reachable in one click —
 * a connected one switches the pane over, a disconnected one starts the
 * connect. Present in the disconnected state too, so the pane never
 * shows a bare toolbar with nothing to act on.
 */
function FtpConnectionDropdown({ current }: { current: FtpHost | null }) {
  const t = useT();
  const hosts = useFtpStore((s) => s.hosts);
  const connected = useFtpStore((s) => s.connected);
  const connecting = useFtpStore((s) => s.connecting);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(h: FtpHost) {
    const st = useFtpStore.getState();
    if (st.connected.includes(h.id)) {
      st.setActive(h.id);
      void st.refresh();
    } else {
      void st.connect(h.id);
    }
    setOpen(false);
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px",
          fontSize: "var(--font-small)", color: "var(--text-1)", background: "var(--panel-1)",
          border: "1px solid var(--border)", borderRadius: 5,
          fontFamily: "\"JetBrains Mono\", var(--font-mono)",
        }}>
        <Server size={13} color="var(--text-2)" style={{ flexShrink: 0 }} />
        <span
          title={current?.label ?? undefined}
          style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current?.label ?? t("Pick a connection")}
        </span>
        <ChevronDown size={11} color="var(--text-3)" />
      </button>
      {open && (
        <ul ref={listRef} role="listbox" style={{
          position: "absolute", top: "100%", left: 0, marginTop: 4,
          width: "var(--drawer-w)", boxSizing: "border-box",
          background: "var(--panel-2)", margin: 0,
          border: "0.5px solid var(--border)", borderRadius: 6,
          padding: 4, zIndex: 100, listStyle: "none",
        }}>
          {hosts.length === 0 && (
            <li style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-3)" }}>
              {t("No FTP connections yet")}
            </li>
          )}
          {hosts.map((h) => {
            const live = connected.includes(h.id);
            const busy = connecting.includes(h.id);
            return (
              <li key={h.id} role="option"
                aria-selected={h.id === current?.id || undefined}
                onClick={() => pick(h)}
                style={{
                  padding: "var(--pad-row-y) var(--pad-row-x)",
                  fontSize: "var(--font-small)", color: "var(--text-1)",
                  cursor: "pointer", borderRadius: 4,
                  display: "flex", alignItems: "center", gap: 6,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--border)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: live && !busy ? "var(--success)" : "var(--accent)",
                  opacity: live || busy ? 1 : 0.3,
                  animation: busy ? "hostrow-pulse 900ms ease-in-out infinite" : undefined,
                }} />
                <span title={h.label} style={{
                  flex: 1, minWidth: 0, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{h.label}</span>
                <span style={{ fontSize: 9, color: "var(--text-3)", flexShrink: 0 }}>
                  {live ? h.protocol.toUpperCase() : t("connect")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
  const connectPhase = useFtpStore((s) => s.connectPhase);
  const cwd = useFtpStore((s) => s.cwd);
  const entries = useFtpStore((s) => s.entries);
  const listedKey = useFtpStore((s) => s.listedKey);
  const listing = useFtpStore((s) => s.listing);
  const error = useFtpStore((s) => s.error);
  const navError = useFtpStore((s) => s.navError);
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
          void (async () => {
            // Loose files in one drop share one gesture group — one
            // strip row for the batch, like each dropped folder gets.
            const kinds = await Promise.all(p.paths.map(async (lp) => {
              try { return await localIsDir(lp); } catch { return null; }
            }));
            const files = p.paths.filter((_, i) => kinds[i] === false);
            const group = files.length >= 2
              ? newGesture(files[0].split(/[\\/]/).pop() || "unknown")
              : undefined;
            for (let i = 0; i < p.paths.length; i++) {
              if (kinds[i] === null) continue;
              const localPath = p.paths[i];
              const name = localPath.split(/[\\/]/).pop() || "unknown";
              void st.upload(localPath, name, kinds[i] ? "directory" : "file", group);
            }
          })();
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
  // It narrates the phases WinSCP-style and stays up until the first
  // directory is actually on screen — connect() only clears the
  // connecting flag after the initial listing lands.
  if (host && !!activeId && connecting.includes(activeId)) {
    const listingPhase = connectPhase === "listing";
    return (
      <ConnectingPanel
        hostLabel={host.label}
        // The default subtitle names the SSH session, which is only true
        // for one of the three protocols this view speaks.
        subtitle={host.protocol === "sftp"
          ? t("Establishing the SSH session.")
          : t("Opening the control connection.")}
        steps={[
          {
            label: listingPhase ? t("Connected") : t("Connecting…"),
            state: listingPhase ? "done" : "active",
          },
          {
            label: t("Reading remote directory…"),
            state: listingPhase ? "active" : "pending",
          },
        ]}
      />
    );
  }

  if (!host || !live) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* The toolbar stays in the disconnected state too — with the
            connection picker in it, the pane is never a dead surface:
            pick a connection right here instead of hunting the sidebar
            (which may be collapsed). */}
        <div style={{
          height: 32, padding: "0 10px", display: "flex", alignItems: "center", gap: 6,
          background: "var(--panel-1)", borderBottom: "0.5px solid var(--border)",
        }}>
          <FtpConnectionDropdown current={host} />
        </div>
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
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
              : host ? t("Not connected") : t("Pick a connection")}
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
        {/* The picker doubles as the pane's title — same as the Files
            view's remote pane, where the host dropdown IS the header. */}
        <FtpConnectionDropdown current={host} />
        <ConnectionTags host={host} />
        <div style={{ flex: 1 }} />
        {/* gap:0 — the buttons' own padding is the spacing; the
            toolbar's gap made the pair look unrelated. */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <PaneToolbarButton title={t("New folder")} onClick={() => void newFolder()}>
            {(size) => <FolderPlus size={size} />}
          </PaneToolbarButton>
          <PaneToolbarButton title={t("Refresh")} onClick={() => void store().refresh()}>
            {(size) => <RefreshCw size={size} />}
          </PaneToolbarButton>
        </div>
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
        {cwd !== "" && cwd !== "/" && (
          <FileRow
            name=".." kind="directory" size={0}
            onOpen={() => void store().navigate(joinPath(cwd, ".."))}
            onRename={() => {}} onDelete={() => {}}
            disabled
          />
        )}
        {/* The hints sit BELOW the ".." row, centred with room to
            breathe — above it they read as a mislaid label. */}
        {listing && entries.length === 0 && (
          <div style={{
            padding: "36px 16px", textAlign: "center",
            color: "var(--text-3)", fontSize: 12,
          }}>
            {t("Loading")}…
          </div>
        )}
        {!listing && entries.length === 0 && !error && (
          <div style={{
            padding: "36px 16px", textAlign: "center",
            color: "var(--text-3)", fontSize: 12,
          }}>
            {t("This folder is empty")}
          </div>
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
      {/* A refused entry (permission denied, usually) answers the click
          with a modal, then leaves the user where they were. */}
      <ErrorDialog
        title={t("Cannot open this folder")}
        message={navError}
        onClose={() => useFtpStore.setState({ navError: null })}
      />
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

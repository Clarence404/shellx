import { useEffect, useState } from "react";
import { Plus, Plug, Unplug, Import, ChevronsLeft } from "lucide-react";
import { Folder, File as FileIcon } from "lucide-react";
import { LocalPane, type RemoteAdapter } from "./LocalPane";
import { TransferStripSection } from "./TransferStripSection";
import { PaneSplitter } from "./PaneSplitter";
import { FtpRemotePane } from "./FtpRemotePane";
import { FtpHostForm } from "./FtpHostForm";
import { FtpImportHosts } from "./FtpImportHosts";
import { ConfirmDeleteHosts } from "./ConfirmDeleteHosts";
import { HostContextMenu } from "./HostContextMenu";
import { SectionHeader } from "./SectionHeader";
import { useFtpStore } from "../state/ftp";
import { useHostsStore } from "../state/hosts";
import { useSessions } from "../state/sessions";
import { useRailFiles } from "../state/railFiles";
import type { FtpHost } from "../types/ftp";
import type { HostInfo } from "../types/host";
import { useT } from "../i18n";

/**
 * The FTP view: its own connection list on the left, then the same
 * local-pane / splitter / remote-pane shape the Files view uses. Only
 * the remote side is new — the local half, the splitter and its
 * remembered position are the components that already exist.
 */
export function FtpView() {
  const t = useT();
  const hosts = useFtpStore((s) => s.hosts);
  const loaded = useFtpStore((s) => s.loaded);
  const activeId = useFtpStore((s) => s.activeId);
  const connected = useFtpStore((s) => s.connected);
  const connecting = useFtpStore((s) => s.connecting);
  const splitterPercent = useRailFiles((s) => s.splitterPercent);
  const setSplitterDraft = useRailFiles((s) => s.setSplitterDraft);
  const setSplitter = useRailFiles((s) => s.setSplitter);

  const [form, setForm] = useState<{ initial: FtpHost | null } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; host: FtpHost } | null>(null);
  const [pending, setPending] = useState<FtpHost | null>(null);
  const [importing, setImporting] = useState(false);
  const savedHostsLoaded = useHostsStore((s) => s.loaded);
  // The same flag and the same toggle the Hosts drawer uses, so the rail
  // click and the keyboard shortcut work here without knowing which view
  // they are in.
  const drawerCollapsed = useSessions((s) => s.drawerCollapsed);
  const toggleDrawer = useSessions((s) => s.toggleDrawer);

  useEffect(() => { if (!loaded) void useFtpStore.getState().load(); }, [loaded]);
  // The import dialog offers saved hosts, which this view may be the
  // first thing to open.
  useEffect(() => {
    if (!savedHostsLoaded) void useHostsStore.getState().load();
  }, [savedHostsLoaded]);

  // Cross-pane gestures in the shared LocalPane land here instead of on
  // the Files view's SFTP session.
  const dragGhost = useRailFiles((s) => s.currentDrag);
  const remoteAdapter: RemoteAdapter = {
    ready: !!activeId && connected.includes(activeId),
    send: (localAbs, name, kind) => void useFtpStore.getState().upload(localAbs, name, kind),
    fetch: (name, kind, localDir) => void useFtpStore.getState().download(name, kind, localDir),
  };

  function open(host: FtpHost) {
    if (connected.includes(host.id)) {
      useFtpStore.getState().setActive(host.id);
      void useFtpStore.getState().refresh();
    } else {
      void useFtpStore.getState().connect(host.id);
    }
  }

  return (
    <div data-testid="ftp-view" style={{
      height: "100%", minHeight: 0, display: "flex", background: "var(--panel-2)",
    }}>
      {!drawerCollapsed && (
      <aside aria-label="ftp connections" style={{
        width: "var(--drawer-w)", flexShrink: 0, background: "var(--panel-1)",
        borderRight: "1px solid var(--border)", padding: "10px 12px",
        display: "flex", flexDirection: "column",
      }}>
        <SectionHeader
          label={t("FTP")}
          action={
            <button
              aria-label="Collapse drawer"
              title={navigator.userAgent.includes("Mac") ? "Collapse (⌘+B)" : "Collapse (Ctrl+Shift+B)"}
              onClick={toggleDrawer}
              style={{
                color: "var(--text-2)", width: 26, height: 26, borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.color = "var(--text-1)"; el.style.background = "var(--panel-2)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLElement;
                el.style.color = "var(--text-2)"; el.style.background = "transparent";
              }}
            >
              <ChevronsLeft size={16} strokeWidth={2} />
            </button>
          }
        />
        <div style={{ flex: 1, overflow: "auto", marginBottom: 8 }}>
          {hosts.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-3)", padding: "8px 4px", lineHeight: 1.7 }}>
              {t("No FTP connections yet")}
            </div>
          )}
          {hosts.map((h) => {
            const live = connected.includes(h.id);
            const busy = connecting.includes(h.id);
            return (
              <button
                key={h.id}
                aria-label={h.label}
                onClick={() => open(h)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, host: h });
                }}
                style={{
                  width: "100%", textAlign: "left", padding: "6px 8px",
                  borderRadius: 4, border: "none", marginBottom: 1,
                  background: h.id === activeId ? "var(--accent-fade)" : "transparent",
                  color: h.id === activeId ? "var(--accent)" : "var(--text-1)",
                  fontSize: "var(--font-ui-size)",
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {/* Same status dot the Hosts sidebar uses (HostRow):
                      green = connected, accent pulse = connecting, dim
                      accent = idle — one vocabulary across the views. */}
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: live && !busy ? "var(--success)" : "var(--accent)",
                    opacity: live || busy ? 1 : 0.3,
                    animation: busy ? "hostrow-pulse 900ms ease-in-out infinite" : undefined,
                    boxShadow: busy ? "0 0 0 0 var(--accent-shadow)" : undefined,
                  }} />
                  <span style={{
                    flex: 1, minWidth: 0, overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{h.label}</span>
                  <span style={{
                    fontSize: 9, lineHeight: "15px", padding: "0 4px", borderRadius: 3,
                    flexShrink: 0,
                    border: `1px solid ${h.protocol === "ftp" ? "var(--warn)" : "var(--success)"}`,
                    background: h.protocol === "ftp" ? "var(--warn-fade)" : "var(--success-fade)",
                    color: h.protocol === "ftp" ? "var(--warn)" : "var(--success)",
                  }}>{h.protocol.toUpperCase()}</span>
                </span>
                <span style={{
                  display: "block", marginLeft: 11, marginTop: 1,
                  fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{h.host}:{h.port}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setForm({ initial: null })}
            style={{
              flex: 1, minWidth: 0,
              height: 34, borderRadius: 6,
              background: "var(--accent-fade)", color: "var(--text-1)",
              border: "1px solid var(--accent)", fontSize: "var(--font-ui-size)",
              fontWeight: 500,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
            <Plus size={15} strokeWidth={2.2} />
            {t("New FTP connection")}
          </button>
          <button
            aria-label={t("Import from saved hosts")}
            title={t("Import from saved hosts")}
            onClick={() => setImporting(true)}
            style={{
              flexShrink: 0, width: 40, height: 34, borderRadius: 6,
              background: "var(--panel-2)", color: "var(--text-2)",
              border: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
            <Import size={16} strokeWidth={2} />
          </button>
        </div>
      </aside>
      )}

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div style={{
            flexBasis: `${splitterPercent}%`, minWidth: 0,
            borderRight: "0.5px solid var(--border)",
          }}>
            <LocalPane remote={remoteAdapter} />
          </div>
          <PaneSplitter percent={splitterPercent} onChange={setSplitterDraft} onCommit={setSplitter} />
          <div style={{ flexBasis: `${100 - splitterPercent}%`, minWidth: 0 }}>
            <FtpRemotePane />
          </div>
        </div>
        {/* Same queue strip as the Files view — FTP transfers are rows in
            the same list, with the same pause / resume / cancel. */}
        <TransferStripSection showAll />
      </div>

      {/* Drag ghost following the pointer — the same one the Files view
          renders, since the drag state itself is shared. */}
      {dragGhost && (
        <div style={{
          position: "fixed",
          left: dragGhost.x + 12, top: dragGhost.y + 8,
          zIndex: 1000, pointerEvents: "none",
          background: "var(--panel-2)",
          border: `0.5px solid ${dragGhost.hoverTarget && dragGhost.hoverTarget !== dragGhost.pane ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 4, padding: "5px 10px",
          boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
          fontSize: "var(--font-body)",
          fontFamily: '"JetBrains Mono", var(--font-mono)',
          color: "var(--text-1)",
          display: "flex", alignItems: "center", gap: 6,
          maxWidth: 320,
          opacity: 0.94,
        }}>
          {dragGhost.kind === "directory"
            ? <Folder size={13} color="var(--text-2)" />
            : <FileIcon size={13} color="var(--text-3)" />}
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {dragGhost.name}
          </span>
        </div>
      )}

      {menu && (
        <HostContextMenu
          x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            connected.includes(menu.host.id)
              ? {
                  label: t("Disconnect"),
                  onClick: () => void useFtpStore.getState().disconnect(menu.host.id),
                  icon: <Unplug size={12} />,
                }
              : {
                  label: t("Connect"),
                  onClick: () => open(menu.host),
                  icon: <Plug size={12} />,
                },
            { kind: "separator" as const },
            { label: t("Edit"), onClick: () => setForm({ initial: menu.host }) },
            {
              label: t("Delete"),
              onClick: () => setPending(menu.host),
              variant: "danger" as const,
            },
          ]}
        />
      )}

      <FtpImportHosts open={importing} onClose={() => setImporting(false)} />

      {form && (
        <div
          role="dialog"
          aria-label="ftp connection form"
          onClick={() => setForm(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          <FtpHostForm
            initial={form.initial}
            onCancel={() => setForm(null)}
            onDone={() => setForm(null)}
          />
        </div>
      )}

      <ConfirmDeleteHosts
        // The dialog speaks HostInfo; only the label and id are read.
        hosts={pending ? ([{ id: pending.id, label: pending.label }] as HostInfo[]) : null}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const doomed = pending;
          setPending(null);
          if (doomed) void useFtpStore.getState().deleteHost(doomed.id);
        }}
      />
    </div>
  );
}

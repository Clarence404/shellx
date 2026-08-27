import { useCallback, useEffect, useState } from "react";
import { Plus, PanelLeftClose, FileDown, Trash2 } from "lucide-react";
import { HostRow } from "./HostRow";
import { SectionHeader } from "./SectionHeader";
import { useHostsStore } from "../state/hosts";
import { useSessions } from "../state/sessions";
import { useRailFiles } from "../state/railFiles";
import { closeSession } from "../ipc/commands";
import type { HostInfo } from "../types/host";
import type { RailView } from "./ActivityRail";
import { ConfirmDeleteHosts } from "./ConfirmDeleteHosts";
import * as select from "../state/hostSelection";
import { useT } from "../i18n";

interface Props {
  view: RailView;
  onNewConnection?: () => void;
  onImportConfig?: () => void;
  onEditHost?: (host: HostInfo) => void;
  onConnectHost?: (host: HostInfo, forceNew?: boolean) => void;
}

export function Drawer({ view, onNewConnection, onImportConfig, onEditHost, onConnectHost }: Props) {
  const t = useT();
  const hosts = useHostsStore((s) => s.hosts);
  const deleteHostById = useHostsStore((s) => s.deleteHostById);
  const addHost = useHostsStore((s) => s.addHost);
  const hostIsConnected = useSessions((s) => s.hostIsConnected);
  const connecting = useSessions((s) => s.connecting);
  // Host of the currently active tab — its row keeps a highlight so the
  // drawer always shows which host the foreground tab belongs to.
  const activeHostId = useSessions((s) => s.sessions.find((x) => x.id === s.activeId)?.host_id ?? null);
  const drawerCollapsed = useSessions((s) => s.drawerCollapsed);
  const toggleDrawer = useSessions((s) => s.toggleDrawer);
  // Multi-select lives here rather than in a store: it is drawer-local,
  // dies with the drawer, and nothing else in the app cares about it.
  const [selection, setSelection] = useState<select.Selection>(select.EMPTY);
  const [pending, setPending] = useState<HostInfo[] | null>(null);
  const ids = hosts.map((h) => h.id);
  const idKey = ids.join(",");
  const selecting = select.isSelecting(selection);

  // Rows that went away (deleted elsewhere, or by us) must not linger in
  // the selection, or the footer would offer to delete nothing.
  useEffect(() => {
    setSelection((s) => select.prune(s, idKey ? idKey.split(",") : []));
  }, [idKey]);

  const clearSelection = useCallback(() => setSelection(select.EMPTY), []);

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
      // Select-all only once a selection exists — an unqualified Ctrl+A
      // belongs to whatever has focus, usually a terminal.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(select.selectAll(idKey ? idKey.split(",") : []));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selecting, idKey, clearSelection]);

  // Views that own their own internal chrome (RailFilesView has its own
  // rail+drawer replacement, SettingsView has SettingsSidebar) don't need the
  // outer Drawer. Serial is a bare "coming soon" placeholder — also skip.
  if (view !== "hosts" || drawerCollapsed) return null;
  // Fresh-install empty state: with no saved hosts, the drawer would only
  // show a "HOSTS" caps label and the "+ New connection" button — the
  // main-area EmptyState already offers that action prominently, so the
  // empty drawer is just visual noise. Hide until the user saves their
  // first host; the drawer then reappears automatically. Manual toggle
  // via rail click still respected once hosts.length > 0.
  if (hosts.length === 0) return null;

  async function deleteOne(host: HostInfo) {
    // Cascade cleanup before removing the row: any tab whose session’s
    // host_id matches gets its backend closed + removed from the store,
    // and if the RemotePane was pointing at one of those sessions, reset
    // it to "Pick a host". Order matters — do this BEFORE deleteHostById
    // so if any step throws, the saved-host row is still there and the
    // user can retry rather than being left with a dangling tab and no
    // way to re-associate it.
    const linkedSessionIds = useSessions.getState().sessions
      .filter((s) => s.host_id === host.id)
      .map((s) => s.id);
    for (const id of linkedSessionIds) {
      try { await closeSession(id); } catch { /* backend may be gone; keep going */ }
      useSessions.getState().removeSession(id);
    }
    const railFiles = useRailFiles.getState();
    if (railFiles.rightHost && linkedSessionIds.includes(railFiles.rightHost)) {
      railFiles.setRightHost(null);
    }
    await deleteHostById(host.id);
  }

  // One confirmation covers the whole batch; the work itself is the same
  // per-host cascade, run in order so a failure part-way through leaves
  // every host it has not reached yet untouched.
  async function handleConfirmedDelete() {
    const doomed = pending ?? [];
    setPending(null);
    for (const host of doomed) await deleteOne(host);
    clearSelection();
  }

  function askDelete(hostsToDelete: HostInfo[]) {
    if (hostsToDelete.length) setPending(hostsToDelete);
  }

  const selectedHosts = hosts.filter((h) => selection.ids.includes(h.id));

  async function handleDuplicate(host: HostInfo) {
    await addHost({
      label: `${host.label} (copy)`,
      host: host.host,
      port: host.port,
      username: host.username,
    });
  }

  // Close every live session tied to this saved host — keep the host row
  // itself. Also reset RemotePane if it was pointing at one of the closed
  // sessions, same guard as handleDelete uses (but without dropping the
  // saved host).
  async function handleDisconnect(host: HostInfo) {
    const linkedSessionIds = useSessions.getState().sessions
      .filter((s) => s.host_id === host.id)
      .map((s) => s.id);
    for (const id of linkedSessionIds) {
      try { await closeSession(id); } catch { /* backend may be gone */ }
      useSessions.getState().removeSession(id);
    }
    const railFiles = useRailFiles.getState();
    if (railFiles.rightHost && linkedSessionIds.includes(railFiles.rightHost)) {
      railFiles.setRightHost(null);
    }
  }

  return (
    <aside aria-label="drawer" style={{
      width: "var(--drawer-w)", flexShrink: 0, background: "var(--panel-1)",
      borderRight: "1px solid var(--border)", padding: "10px 12px",
      display: "flex", flexDirection: "column",
    }}>
      <SectionHeader
        label={selecting ? `${t("Hosts")} · ${t("selected")} ${selection.ids.length}` : t("Hosts")}
        action={
          <button
            aria-label="Collapse drawer"
            title={navigator.userAgent.includes("Mac") ? "Collapse (⌘+B)" : "Collapse (Ctrl+Shift+B)"}
            onClick={toggleDrawer}
            style={{
              color: "var(--text-3)", padding: "2px 4px", borderRadius: 3,
              display: "flex", alignItems: "center",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-1)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-3)"; }}
          >
            <PanelLeftClose size={12} strokeWidth={2} />
          </button>
        }
      />
      <div
        // A click that lands on the list itself rather than a row is the
        // usual way people expect to drop a selection.
        onClick={(e) => { if (e.target === e.currentTarget) clearSelection(); }}
        style={{ flex: 1, overflow: "auto", marginBottom: 8 }}
      >
        {view === "hosts" && hosts.map((h, index) => {
          const connected = hostIsConnected(h.id);
          return (
            <HostRow
              key={h.id}
              host={h}
              selected={selection.ids.includes(h.id)}
              selecting={selecting}
              onSelect={(mods) => {
                const outcome = select.clickRow(selection, index, ids, mods);
                setSelection(outcome.selection);
                if (outcome.kind === "connect") onConnectHost?.(h);
              }}
              onContextMenuOpen={() => {
                setSelection(select.contextRow(selection, index, ids).selection);
              }}
              bulkItems={
                selection.ids.includes(h.id) && selection.ids.length > 1
                  ? [
                      {
                        label: `${t("Delete")} ${selection.ids.length} ${t("hosts")}`,
                        onClick: () => askDelete(selectedHosts),
                        variant: "danger" as const,
                      },
                      { label: t("Clear selection"), onClick: clearSelection },
                    ]
                  : undefined
              }
              isConnected={connected}
              isConnecting={!!connecting[h.id]}
              isActive={h.id === activeHostId}
              onConnect={() => onConnectHost?.(h)}
              onOpenNewShell={() => onConnectHost?.(h, true)}
              // Disconnect only surfaces when at least one live session
              // matches this host_id — otherwise there's nothing to close
              // and the menu item would confuse.
              onDisconnect={connected ? () => void handleDisconnect(h) : undefined}
              onEdit={() => onEditHost?.(h)}
              onDuplicate={() => handleDuplicate(h)}
              onDelete={() => askDelete([h])}
            />
          );
        })}
      </div>
      {view === "hosts" && selecting && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => askDelete(selectedHosts)}
            style={{
              flex: 1, minWidth: 0,
              padding: "6px 8px", borderRadius: 5,
              background: "var(--error-fade)", color: "var(--error)",
              border: "1px solid var(--error)", fontSize: "var(--font-ui-size)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            <Trash2 size={12} strokeWidth={2.5} />
            {t("Delete")} {selection.ids.length}
          </button>
          <button
            onClick={clearSelection}
            style={{
              flexShrink: 0, padding: "6px 10px", borderRadius: 5,
              background: "var(--panel-2)", color: "var(--text-2)",
              border: "1px solid var(--border)", fontSize: "var(--font-ui-size)",
            }}>
            {t("Cancel")}
          </button>
        </div>
      )}
      {view === "hosts" && !selecting && onNewConnection && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onNewConnection}
            style={{
              flex: 1, minWidth: 0,
              padding: "6px 8px", borderRadius: 5,
              background: "var(--accent-fade)", color: "var(--text-1)",
              border: "1px solid var(--accent)", fontSize: "var(--font-ui-size)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
            <Plus size={12} strokeWidth={2.5} />
            {t("New connection")}
          </button>
          {onImportConfig && (
            <button
              aria-label={t("Import from SSH config")}
              title={t("Import from SSH config")}
              onClick={onImportConfig}
              style={{
                flexShrink: 0, padding: "6px 8px", borderRadius: 5,
                background: "var(--panel-2)", color: "var(--text-2)",
                border: "1px solid var(--border)",
                display: "flex", alignItems: "center",
              }}>
              <FileDown size={12} strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
      <ConfirmDeleteHosts
        hosts={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => void handleConfirmedDelete()}
      />
    </aside>
  );
}

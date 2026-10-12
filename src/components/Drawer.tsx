import { useCallback, useEffect, useState } from "react";
import { Plus, ChevronsLeft, Import, Trash2, Search, X, Check, FolderPlus, FolderInput } from "lucide-react";
import { HostRow } from "./HostRow";
import { HostGroupHeader } from "./HostGroupHeader";
import { GroupNameDialog } from "./GroupNameDialog";
import { ErrorDialog } from "./ErrorDialog";
import { HostContextMenu, type MenuItem } from "./HostContextMenu";
import { SectionHeader } from "./SectionHeader";
import { useHostsStore } from "../state/hosts";
import { useAlerts, alertCountByHost } from "../state/alerts";
import { useSessions } from "../state/sessions";
import { useRailFiles } from "../state/railFiles";
import { closeSession } from "../ipc/commands";
import type { HostInfo } from "../types/host";
import type { RailView } from "./ActivityRail";
import { ConfirmDeleteHosts } from "./ConfirmDeleteHosts";
import * as select from "../state/hostSelection";
import {
  buildView, groupNames, groupOf, loadCollapsed, saveCollapsed,
} from "../state/hostGroups";
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
  const updateHostById = useHostsStore((s) => s.updateHostById);
  const hostIsConnected = useSessions((s) => s.hostIsConnected);
  // Alert badges: counted per host, summed over that host's sessions.
  const alertsByConn = useAlerts((s) => s.byConn);
  const allSessions = useSessions((s) => s.sessions);
  const alertsByHost = alertCountByHost(alertsByConn, allSessions);
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
  // Sidebar search and groups (docs/superpowers/specs/2026-10-12-v0.35-host-groups-and-search-design.md).
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [nameDialog, setNameDialog] = useState<
    { kind: "new"; targets: HostInfo[] } | { kind: "rename"; group: string } | null
  >(null);
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number } | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  // What is on screen — groups, collapsed state and the query applied. The
  // selection code addresses rows by index into THIS order, not the raw
  // host list, so a Shift range can never take in a row the user can't see.
  const hv = buildView(hosts, query, collapsed, hostIsConnected);
  const ids = hv.visibleIds;
  const idKey = ids.join(",");
  const selecting = select.isSelecting(selection);

  // Rows that went away (deleted elsewhere, or by us) must not linger in
  // the selection, or the footer would offer to delete nothing.
  // Collapsing a group or typing a query reorders what is visible, which
  // also invalidates the Shift-range anchor (an index into the old order).
  useEffect(() => {
    const visible = idKey ? idKey.split(",") : [];
    setSelection((s) => {
      if (s.ids.length === 0 && s.anchor === null) return s;
      const kept = s.ids.filter((id) => visible.includes(id));
      if (kept.length === s.ids.length && s.anchor === null) return s;
      return kept.length ? { ids: kept, anchor: null } : select.EMPTY;
    });
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
  const existingGroups = groupNames(hosts);

  // A group move is one update_host per host — there is no group table, so
  // "rename" and "dissolve" are just this over the members. Not atomic: a
  // failure part-way leaves the rest on the old name, visibly and retryably.
  async function moveHosts(targets: HostInfo[], group: string | null) {
    for (const h of targets) {
      if (groupOf(h) === group) continue;
      try {
        await updateHostById({ id: h.id, group_name: group });
      } catch (e) {
        setGroupError(`Could not move "${h.label}": ${String(e)}`);
        return;
      }
    }
  }

  function toggleGroup(name: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      saveCollapsed(next);
      return next;
    });
  }

  async function renameGroup(from: string, to: string) {
    const members = hosts.filter((h) => groupOf(h) === from);
    await moveHosts(members, to);
    setCollapsed((prev) => {
      if (!prev.has(from)) return prev;
      const next = new Set(prev);
      next.delete(from);
      saveCollapsed(next);
      return next;
    });
  }

  async function dissolveGroup(name: string) {
    await moveHosts(hosts.filter((h) => groupOf(h) === name), null);
  }

  /** The "Move to group" entries for these hosts — one menu section, shared
   *  by the single-host menu, the batch menu and the footer button. */
  function moveItemsFor(targets: HostInfo[]): MenuItem[] {
    const allIn = (g: string) => targets.every((h) => groupOf(h) === g);
    const after = () => { if (targets.length > 1) clearSelection(); };
    return [
      {
        kind: "section",
        label: targets.length > 1
          ? `${t("Move")} ${targets.length} ${t("hosts")} ${t("to group")}`
          : t("Move to group"),
      },
      ...existingGroups.map((g): MenuItem => ({
        label: g,
        icon: allIn(g) ? <Check size={12} /> : undefined,
        onClick: () => { void moveHosts(targets, g).then(after); },
      })),
      { label: t("New group…"), icon: <FolderPlus size={12} />, onClick: () => setNameDialog({ kind: "new", targets }) },
      ...(targets.some((h) => groupOf(h) !== null)
        ? [{
            label: t("Remove from group"),
            onClick: () => { void moveHosts(targets, null).then(after); },
          } as MenuItem]
        : []),
    ];
  }

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
        label={selecting
          ? `${t("Hosts")} · ${t("selected")} ${selection.ids.length}`
          : query.trim() ? `${t("Hosts")} · ${hv.matchCount}/${hosts.length}` : t("Hosts")}
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
      <div style={{ position: "relative", marginBottom: 8 }}>
        <Search size={13} style={{ position: "absolute", left: 9, top: 9, color: "var(--text-3)", pointerEvents: "none" }} />
        <input
          aria-label={t("Search hosts")}
          placeholder={t("Search hosts…")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery("");
            } else if (e.key === "Enter") {
              // Same as clicking the first row that is on screen.
              e.preventDefault();
              const first = hosts.find((h) => h.id === ids[0]);
              if (first) onConnectHost?.(first);
            }
          }}
          style={{
            width: "100%", height: 30, padding: "0 26px 0 28px", borderRadius: 6,
            background: "var(--panel-2)", border: "1px solid var(--border)",
            color: "var(--text-1)", fontSize: "var(--font-ui-size)",
          }}
        />
        {query && (
          <button
            aria-label={t("Clear search")}
            onClick={() => setQuery("")}
            style={{
              position: "absolute", right: 4, top: 4, width: 22, height: 22, borderRadius: 4,
              display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-3)",
            }}
          ><X size={13} /></button>
        )}
      </div>
      <div
        // A click that lands on the list itself rather than a row is the
        // usual way people expect to drop a selection.
        onClick={(e) => { if (e.target === e.currentTarget) clearSelection(); }}
        style={{ flex: 1, overflow: "auto", marginBottom: 8 }}
      >
        {view === "hosts" && query.trim() && hv.items.length === 0 && (
          <div style={{ padding: "24px 8px", textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>
            {t("No hosts match")} “{query.trim()}”
          </div>
        )}
        {view === "hosts" && hv.items.map((item) => {
          if (item.kind === "group") {
            return (
              <HostGroupHeader
                key={`g:${item.name}`}
                name={item.name} total={item.total} online={item.online} open={item.open}
                query={query}
                onToggle={() => toggleGroup(item.name)}
                onRename={() => setNameDialog({ kind: "rename", group: item.name })}
                onDissolve={() => void dissolveGroup(item.name)}
              />
            );
          }
          if (item.kind === "ungrouped") {
            return (
              <div key="ungrouped" style={{
                display: "flex", alignItems: "center", padding: "10px 6px 4px", gap: 6,
                fontSize: "calc(var(--font-ui-size) - 1px)", fontWeight: 600, color: "var(--text-3)",
              }}>
                <span style={{ flex: 1 }}>{t("Ungrouped")}</span>
                <span style={{ fontWeight: 400, fontSize: 11 }}>{item.total}</span>
              </div>
            );
          }
          const h = item.host;
          const index = ids.indexOf(h.id);
          const connected = hostIsConnected(h.id);
          return (
            <HostRow
              key={h.id}
              host={h}
              indent={item.grouped}
              query={query}
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
              moveItems={[...moveItemsFor([h]), { kind: "separator" as const }]}
              bulkItems={
                selection.ids.includes(h.id) && selection.ids.length > 1
                  ? [
                      ...moveItemsFor(selectedHosts),
                      { kind: "separator" as const },
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
              alertCount={alertsByHost[h.id] ?? 0}
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
        <div style={{ display: "flex", gap: 8 }}>
          <button
            aria-label={t("Move to group")}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMoveMenu({ x: r.left, y: r.top });
            }}
            style={{
              flex: 1, minWidth: 0, height: 34, borderRadius: 6,
              background: "var(--accent-fade)", color: "var(--text-1)",
              border: "1px solid var(--accent)", fontSize: "var(--font-ui-size)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
            <FolderInput size={15} strokeWidth={2.2} />
            {t("Move")} {selection.ids.length}
          </button>
          <button
            onClick={() => askDelete(selectedHosts)}
            style={{
              flex: 1, minWidth: 0,
              height: 34, borderRadius: 6,
              background: "var(--error-fade)", color: "var(--error)",
              border: "1px solid var(--error)", fontSize: "var(--font-ui-size)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
            <Trash2 size={15} strokeWidth={2.2} />
            {t("Delete")} {selection.ids.length}
          </button>
          <button
            onClick={clearSelection}
            style={{
              flexShrink: 0, height: 34, padding: "0 12px", borderRadius: 6,
              background: "var(--panel-2)", color: "var(--text-2)",
              border: "1px solid var(--border)", fontSize: "var(--font-ui-size)",
            }}>
            {t("Cancel")}
          </button>
        </div>
      )}
      {view === "hosts" && !selecting && onNewConnection && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onNewConnection}
            style={{
              flex: 1, minWidth: 0,
              height: 34, borderRadius: 6,
              background: "var(--accent-fade)", color: "var(--text-1)",
              border: "1px solid var(--accent)", fontSize: "var(--font-ui-size)",
              fontWeight: 500,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
            <Plus size={15} strokeWidth={2.2} />
            {t("New connection")}
          </button>
          {onImportConfig && (
            <button
              aria-label={t("Import from SSH config")}
              title={t("Import from SSH config")}
              onClick={onImportConfig}
              style={{
                flexShrink: 0, width: 40, height: 34, borderRadius: 6,
                background: "var(--panel-2)", color: "var(--text-2)",
                border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              <Import size={16} strokeWidth={2} />
            </button>
          )}
        </div>
      )}
      {moveMenu && (
        <HostContextMenu
          x={moveMenu.x} y={moveMenu.y}
          items={moveItemsFor(selectedHosts)}
          onClose={() => setMoveMenu(null)}
        />
      )}
      <GroupNameDialog
        open={nameDialog !== null}
        title={nameDialog?.kind === "rename" ? t("Rename group") : t("New group")}
        initial={nameDialog?.kind === "rename" ? nameDialog.group : ""}
        existing={existingGroups}
        confirmLabel={nameDialog?.kind === "rename" ? t("Rename") : t("Create & move")}
        onCancel={() => setNameDialog(null)}
        onSubmit={(name) => {
          const d = nameDialog;
          setNameDialog(null);
          if (!d) return;
          if (d.kind === "rename") void renameGroup(d.group, name);
          else void moveHosts(d.targets, name).then(() => { if (d.targets.length > 1) clearSelection(); });
        }}
      />
      <ErrorDialog message={groupError} onClose={() => setGroupError(null)} />
      <ConfirmDeleteHosts
        hosts={pending}
        onCancel={() => setPending(null)}
        onConfirm={() => void handleConfirmedDelete()}
      />
    </aside>
  );
}

import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { TerminalView } from "./components/TerminalView";
import { ActivityToolbar } from "./components/ActivityToolbar";
import { FileBrowserView } from "./components/FileBrowserView";
import { RailFilesView } from "./components/RailFilesView";
import { ConnectDialog } from "./components/ConnectDialog";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsView } from "./components/settings/SettingsView";
import { useSessions } from "./state/sessions";
import { useHostsStore } from "./state/hosts";
import { useSettingsStore } from "./state/settings";
import { useRailFiles } from "./state/railFiles";
import { SYSTEM_FONT_MAP } from "./types/settings";
import { useTransfersStore } from "./state/transfers";
import { closeSession, openConnection } from "./ipc/commands";
import { getHostPassword } from "./ipc/hosts";
import { onConnectionClosed } from "./ipc/events";
import { onTransferStarted, onTransferProgress, onTransferDone } from "./ipc/transfers";
import { useTabHotkeys } from "./hooks/useTabHotkeys";
import type { HostInfo } from "./types/host";

export function App() {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const setActive = useSessions((s) => s.setActive);
  const addSession = useSessions((s) => s.addSession);
  const removeSession = useSessions((s) => s.removeSession);
  const markSessionClosed = useSessions((s) => s.markSessionClosed);
  const activeActivity = useSessions((s) =>
    s.activeId ? (s.activeActivity[s.activeId] ?? "terminal") : "terminal"
  );
  const setActivity = useSessions((s) => s.setActivity);
  const railView = useSessions((s) => s.railView);
  const toggleDrawer = useSessions((s) => s.toggleDrawer);

  const loadHosts = useHostsStore((s) => s.load);
  const themeId = useSettingsStore((s) => s.themeId);
  const density = useSettingsStore((s) => s.density);
  const systemFont = useSettingsStore((s) => s.systemFont);
  const systemFontSize = useSettingsStore((s) => s.systemFontSize);
  const filesFontSize = useSettingsStore((s) => s.filesFontSize);

  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; initial: HostInfo }
    | null
  >(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => { void loadHosts(); }, [loadHosts]);

  // Load persisted settings once on mount. If none exist, the store's
  // DEFAULT_SETTINGS remain in effect.
  useEffect(() => { void useSettingsStore.getState().load(); }, []);

  // Sync themeId / density to <html data-*> attributes so tokens.css can
  // pick up the correct :root[data-…] variable block. Empty string on
  // "warm-minimal" / "comfortable" means "no attribute" → default block.
  useEffect(() => {
    const el = document.documentElement;
    if (themeId === "warm-minimal") delete el.dataset.theme; else el.dataset.theme = themeId;
    if (density === "comfortable") delete el.dataset.density; else el.dataset.density = density;
  }, [themeId, density]);

  // Sync systemFont to the --font-ui CSS custom property. body inherits
  // font-family from :root via reset.css, so every sans UI element picks
  // this up. "system-default" clears the override so tokens.css's own
  // default fallback chain applies.
  useEffect(() => {
    const el = document.documentElement;
    if (systemFont === "system-default") {
      el.style.removeProperty("--font-ui");
    } else {
      el.style.setProperty("--font-ui", SYSTEM_FONT_MAP[systemFont]);
    }
  }, [systemFont]);

  // Sync systemFontSize to --font-ui-size. Elements that render sans
  // chrome (tabs, settings sidebar rows, body-inherited text) pick this
  // up. File-list content stays on --font-body (density-controlled).
  useEffect(() => {
    document.documentElement.style.setProperty("--font-ui-size", `${systemFontSize}px`);
  }, [systemFontSize]);

  // Sync filesFontSize to --font-files-size. FileRow's filename / meta
  // pick this up. Kept separate from --font-body so cranking file rows
  // doesn't inflate row padding or every other density-sized element.
  useEffect(() => {
    document.documentElement.style.setProperty("--font-files-size", `${filesFontSize}px`);
  }, [filesFontSize]);

  // Wire transfer started/progress/done events into the transfers store. Uses
  // the `cancelled` flag guard (see FileBrowserView's drag-drop listener)
  // since onTransferStarted/onTransferProgress/onTransferDone resolve
  // asynchronously and this effect could unmount before the listener
  // registration promise settles.
  useEffect(() => {
    const store = useTransfersStore.getState();
    let cancelled = false;
    const unlistens: Array<() => void> = [];

    onTransferStarted((info) => store.applyStarted(info)).then((u) => {
      if (cancelled) { u(); return; }
      unlistens.push(u);
    });
    onTransferProgress((ev) => store.applyProgress(ev)).then((u) => {
      if (cancelled) { u(); return; }
      unlistens.push(u);
    });
    onTransferDone((ev) => {
      store.applyDone(ev);
      // v0.5.7: refresh RailFiles panes on every completed transfer so
      // the new file appears immediately without a manual refresh. We
      // don't filter by direction — either side of a completed transfer
      // may have gained a new entry, so re-listing both keeps them
      // in sync with minimal overhead.
      const rf = useRailFiles.getState();
      if (rf.leftPath) void rf.loadLeft();
      if (rf.rightHost) void rf.loadRight();
    }).then((u) => {
      if (cancelled) { u(); return; }
      unlistens.push(u);
    });

    void store.loadInitial();

    return () => {
      cancelled = true;
      unlistens.forEach((u) => u());
    };
  }, []);

  // Wire the backend's connection:closed event into the sessions store:
  // fade the tab first (markSessionClosed), then drop it from the list once
  // the fade transition (300ms, see TabBar) has had time to play out. Guarded
  // with the same `cancelled` pattern as the transfer listeners above since
  // onConnectionClosed resolves asynchronously.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    onConnectionClosed(({ id }) => {
      markSessionClosed(id);
      setTimeout(() => removeSession(id), 300);
    }).then((u) => {
      if (cancelled) { u(); return; }
      unlisten = u;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [markSessionClosed, removeSession]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // Suppress the WebView's default right-click menu (Back / Refresh /
  // Save as…) — this is a desktop app, that menu doesn't belong.
  // Components with their own context menus (HostRow, FileRow) call
  // preventDefault in their onContextMenu synthetic handlers, which run
  // AFTER this native capture and open their custom popover via state;
  // both paths coexist. Text inputs lose their native copy/paste menu
  // as collateral — keyboard shortcuts still work.
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  useEffect(() => {
    // Ctrl+B collides with terminal readline's backward-char emacs binding,
    // so on Windows/Linux the drawer-toggle chord requires Shift too. macOS
    // keeps plain Cmd+B since Cmd isn't a modifier readline binds to. Mirrors
    // the same class of fix in useTabHotkeys.ts for Ctrl+T/W.
    const handler = (e: KeyboardEvent) => {
      const isMacOs = navigator.userAgent.includes("Mac");
      const mod = isMacOs ? e.metaKey : (e.ctrlKey && e.shiftKey);
      if (mod && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        toggleDrawer();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [toggleDrawer]);

  useTabHotkeys({
    onNewTab: () => setDialog({ mode: "create" }),
    onCloseTab: () => {
      if (activeId) {
        void closeSession(activeId);
        removeSession(activeId);
      }
    },
    onNextTab: () => {
      if (sessions.length < 2 || !activeId) return;
      const idx = sessions.findIndex((s) => s.id === activeId);
      setActive(sessions[(idx + 1) % sessions.length].id);
    },
    onPrevTab: () => {
      if (sessions.length < 2 || !activeId) return;
      const idx = sessions.findIndex((s) => s.id === activeId);
      setActive(sessions[(idx - 1 + sessions.length) % sessions.length].id);
    },
  });

  async function handleConnectSavedHost(host: HostInfo) {
    // Ignore double-clicks during an in-flight handshake for the same host.
    // Two openConnection calls to the same server would both succeed but only
    // one tab would win the fight for activeId — the other is orphaned.
    const st = useSessions.getState();
    if (st.connecting[host.id]) return;

    // v0.5.7: if this host already has a live session, focus its tab
    // instead of opening a duplicate. Prevents the "two tabs for same
    // host after Files-view round-trip" bug. Closed sessions don't
    // count (state !== "active"), so Reconnect from DisconnectedPanel
    // still creates a fresh session as intended.
    const existing = st.sessions.find(
      (s) => s.host_id === host.id && s.state === "active",
    );
    if (existing) {
      setActive(existing.id);
      return;
    }

    // Try to fetch password from keychain; if missing, prompt via ConnectDialog
    const password = await getHostPassword(host.id);
    if (!password) {
      // Fall back to edit-mode dialog so user can enter password once
      setDialog({ mode: "edit", initial: host });
      return;
    }
    st.beginConnecting(host.id);
    try {
      const info = await openConnection({
        host: host.host, port: host.port,
        username: host.username, password,
        label: host.label,
        host_id: host.id,
      });
      addSession(info);  // clears the connecting flag as part of the same set
    } catch (e) {
      useSessions.getState().endConnecting(host.id);
      alert(`Connection failed: ${e}`);
    }
  }

  const tabs = sessions.map((s) => ({ id: s.id, title: s.label, state: s.state }));

  return (
    <>
      <AppShell
        tabs={tabs}
        activeTabId={activeId}
        onTabSelect={setActive}
        onTabClose={(id) => { void closeSession(id); removeSession(id); }}
        onTabsClose={(ids) => {
          // Batch close: fire the backend close for each session, then
          // remove them all from the frontend list. onConnectionClosed
          // events may still land afterward but markSessionClosed is a
          // no-op once removed, so no double-teardown.
          ids.forEach((id) => { void closeSession(id); removeSession(id); });
        }}
        onNewConnection={() => setDialog({ mode: "create" })}
        onEditHost={(host) => setDialog({ mode: "edit", initial: host })}
        onConnectHost={(host) => void handleConnectSavedHost(host)}
      >
        {/* Tab body stays mounted whenever activeId exists — hide via
            display:none when the user is on a rail-level view (Files /
            Settings / Protocols) so xterm state (scrollback, buffer,
            connection) survives round-trips, and live-reconfigure of
            terminal settings takes effect on the mounted xterm even
            while the Settings pane is being viewed. */}
        {activeId && (
          <div style={{
            display: railView === "hosts" ? "flex" : "none",
            flexDirection: "column", height: "100%", minHeight: 0,
          }}>
            <ActivityToolbar
              activity={activeActivity}
              onChange={(a) => setActivity(activeId, a)}
            />
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              <div style={{ display: activeActivity === "terminal" ? "block" : "none", height: "100%" }}>
                <TerminalView sessionId={activeId} />
              </div>
              <div style={{ display: activeActivity === "files" ? "block" : "none", height: "100%" }}>
                <FileBrowserView connectionId={activeId} />
              </div>
            </div>
          </div>
        )}

        {railView === "hosts" && !activeId && (
          <EmptyState onNewConnection={() => setDialog({ mode: "create" })} />
        )}
        {railView === "files" && (
          <RailFilesView onConnectSavedHost={(host) => void handleConnectSavedHost(host)} />
        )}
        {railView === "settings" && <SettingsView />}
        {railView === "protocols" && (
          <div style={{
            height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-3)", fontSize: 13, fontStyle: "italic",
          }}>
            Protocols · coming soon
          </div>
        )}
      </AppShell>
      <ConnectDialog
        open={dialog !== null}
        mode={dialog?.mode ?? "create"}
        initial={dialog?.mode === "edit" ? dialog.initial : undefined}
        onClose={() => setDialog(null)}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onConnect={(host) => void handleConnectSavedHost(host)}
      />
    </>
  );
}

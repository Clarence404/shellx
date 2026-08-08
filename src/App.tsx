import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { ConnectingPanel } from "./components/ConnectingPanel";
import { ErrorDialog } from "./components/ErrorDialog";
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
import { useFilesStore } from "./state/files";
import { SYSTEM_FONT_MAP } from "./types/settings";
import { useTransfersStore } from "./state/transfers";
import { closeSession, openConnection } from "./ipc/commands";
import { getHostPassword } from "./ipc/hosts";
import { onConnectionClosed } from "./ipc/events";
import { installSessionStream } from "./state/sessionStream";
import { onTransferStarted, onTransferProgress, onTransferDone, onTransferState } from "./ipc/transfers";
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
  // First host-id currently mid-connect. Drives the Connecting panel that
  // fills the main pane while the SSH handshake is in flight and there's
  // no active session yet (the very-first-connect flow). If more than one
  // handshake is running we just surface the first — the tab bar / rail
  // pulse still communicates the rest.
  const connectingHostId = useSessions((s) => Object.keys(s.connecting)[0] ?? null);
  // Look up the label for the connecting host from the saved-hosts store.
  // Falls back to the raw id (a UUID) — ugly but non-blank if the host was
  // somehow removed mid-connect. Subscribing to hosts here so a rename
  // during handshake re-renders the panel.
  const connectingHostLabel = useHostsStore((s) => {
    if (!connectingHostId) return "";
    const h = s.hosts.find((x) => x.id === connectingHostId);
    return h?.label ?? h?.host ?? connectingHostId;
  });

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
  // In-app error banner. Replaces window.alert() which uses the OS's
  // native positioning (WebView2 opens it at the top-left of the app
  // window on Windows, floating disconnected from shellx's chrome).
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => { void loadHosts(); }, [loadHosts]);

  // Load persisted settings once on mount. If none exist, the store's
  // DEFAULT_SETTINGS remain in effect.
  useEffect(() => { void useSettingsStore.getState().load(); }, []);

  // Wire the global session:data router. Buffers per-session bytes until a
  // TerminalView subscribes, so a freshly opened tab doesn't lose its
  // welcome banner + prompt to the mount-vs-Rust-pump race.
  useEffect(() => { installSessionStream(); }, []);

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
    onTransferState((ev) => store.applyState(ev)).then((u) => {
      if (cancelled) { u(); return; }
      unlistens.push(u);
    });
    // Coalesce the post-transfer refresh across bursts of
    // `transfer:done` events. A 30-file directory upload was firing
    // 30 back-to-back loadLeft / loadRight pairs — 60 SFTP list_dir
    // calls total. Debouncing lets the pane refresh once ~300 ms
    // after the LAST child finishes, and the intermediate refreshes
    // don't pound the SFTP subchannel (or paint "Loading…" flashes).
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    onTransferDone((ev) => {
      store.applyDone(ev);
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        const rf = useRailFiles.getState();
        if (rf.leftPath) void rf.loadLeft();
        if (rf.rightHost) void rf.loadRight();
        // Also refresh any per-connection FileBrowserView views —
        // Hosts > Files subscribes to `useFilesStore.perConnection`,
        // and without a reload here the newly-uploaded file only
        // showed up after a manual refresh click.
        const fs = useFilesStore.getState();
        for (const [connId, ps] of Object.entries(fs.perConnection)) {
          if (ps?.cwd) void fs.loadDir(connId, ps.cwd);
        }
      }, 300);
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

  async function handleConnectSavedHost(host: HostInfo, forceNew: boolean = false) {
    // Ignore concurrent in-flight handshakes for the same host — two
    // simultaneous `open_connection` calls would both succeed but only
    // one tab could win the fight for activeId. The `forceNew` path
    // still respects this to avoid spawning a second session on a
    // brief second click during the first connection.
    //
    // RemotePane's disconnected-state effect clears this flag when a
    // session ends, so a Reconnect click coming out of DisconnectedPanel
    // sees a clean slate.
    const st = useSessions.getState();
    if (st.connecting[host.id]) {
      console.warn("[handleConnectSavedHost] already connecting to", host.id, host.label);
      return;
    }

    // Single-click semantics (default): if the host already has a live
    // session, focus that tab instead of opening a duplicate. This
    // prevents the "two tabs for same host after Files-view round-trip"
    // bug. Closed sessions don't count so Reconnect from
    // DisconnectedPanel still creates a fresh session as intended.
    //
    // `forceNew = true` skips the dedup so a double-click on a host row
    // opens a second concurrent shell to the same server.
    if (!forceNew) {
      const existing = st.sessions.find(
        (s) => s.host_id === host.id && s.state === "active",
      );
      if (existing) {
        setActive(existing.id);
        return;
      }
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
      setErrorMsg(`Connection failed: ${e}`);
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
        onConnectHost={(host, forceNew) => void handleConnectSavedHost(host, forceNew)}
      >
        {/* Tab body stays mounted whenever activeId exists — hide via
            display:none when the user is on a rail-level view (Files /
            Settings / Serial) so xterm state (scrollback, buffer,
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
              {/* One TerminalView + FileBrowserView per session, always
                  mounted, toggled via display. Rendering only the active
                  session (previous shape) forced xterm.js to dispose and
                  recreate on every tab switch — the shell process kept
                  running on the backend but its accumulated output (welcome
                  banner, PS1 prompt) was written to a Terminal that no
                  longer existed. When the tab was re-visited, the new
                  Terminal instance only received bytes from that point on,
                  so the top rows read blank until the user hit Enter and
                  the shell echoed a fresh prompt. Keeping every session's
                  view mounted means each xterm keeps its own scrollback
                  intact across tab switches. */}
              {sessions.map((s) => {
                const isActive = s.id === activeId;
                return (
                  <div key={s.id} style={{
                    display: isActive ? "block" : "none",
                    position: "absolute", inset: 0,
                  }}>
                    <div style={{ display: activeActivity === "terminal" ? "block" : "none", height: "100%" }}>
                      <TerminalView sessionId={s.id} />
                    </div>
                    <div style={{ display: activeActivity === "files" ? "block" : "none", height: "100%" }}>
                      <FileBrowserView connectionId={s.id} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {railView === "hosts" && !activeId && connectingHostId && (
          // First-connect from the Hosts sidebar: no session yet, but a
          // handshake is in flight. Show the shared ConnectingPanel here
          // instead of EmptyState so the user sees an unmistakable signal
          // while the SSH negotiation runs. Cancel calls endConnecting;
          // the underlying openConnection can't be aborted mid-flight so
          // if it happens to succeed anyway, the session still lands
          // (addSession fires and swaps this panel out for the terminal).
          <ConnectingPanel
            hostLabel={connectingHostLabel}
            onCancel={() => useSessions.getState().endConnecting(connectingHostId)}
          />
        )}
        {railView === "hosts" && !activeId && !connectingHostId && (
          <EmptyState onNewConnection={() => setDialog({ mode: "create" })} />
        )}
        {railView === "files" && (
          <RailFilesView onConnectSavedHost={(host) => void handleConnectSavedHost(host)} />
        )}
        {railView === "settings" && <SettingsView />}
        {railView === "serial" && (
          <div style={{
            height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--text-3)", fontSize: 13, fontStyle: "italic",
          }}>
            Serial · coming soon
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
      <ErrorDialog message={errorMsg} onClose={() => setErrorMsg(null)} />
    </>
  );
}

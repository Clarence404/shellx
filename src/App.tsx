import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { ConnectingPanel } from "./components/ConnectingPanel";
import { ErrorDialog } from "./components/ErrorDialog";
import { TerminalView } from "./components/TerminalView";
import { FileBrowserView } from "./components/FileBrowserView";
import { TunnelsPanel } from "./components/TunnelsPanel";
import { MonitorPanel } from "./components/MonitorPanel";
import { MonitorBoundary } from "./components/monitor/MonitorBoundary";
import { RailFilesView } from "./components/RailFilesView";
import { GlobalTunnelsView } from "./components/GlobalTunnelsView";
import { PaneLayout } from "./components/PaneLayout";
import { activitiesFor, clampActivity } from "./state/activities";
import { SessionSurfaces } from "./components/SessionSurfaces";
import { ConnectDialog } from "./components/ConnectDialog";
import { SshConfigImport } from "./components/SshConfigImport";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsView } from "./components/settings/SettingsView";
import { useSessions } from "./state/sessions";
import { useHostsStore } from "./state/hosts";
import { useSettingsStore } from "./state/settings";
import { useRailFiles } from "./state/railFiles";
import { useFilesStore } from "./state/files";
import { useUpdater } from "./state/updater";
import { SYSTEM_FONT_MAP } from "./types/settings";
import { useTransfersStore } from "./state/transfers";
import { closeSession, openConnection } from "./ipc/commands";
import { openLocalTerminal } from "./ipc/local_pty";
import { getHostPassword, getHostPassphrase, setHostPassphrase } from "./ipc/hosts";
import { onConnectionClosed } from "./ipc/events";
import { onHostkeyChallenge } from "./ipc/hostkeys";
import { useChallenges } from "./state/challenges";
import { usePassphrase } from "./state/passphrase";
import { parseConnectError } from "./types/connect-error";
import { HostKeyDialog } from "./components/HostKeyDialog";
import { PassphraseDialog } from "./components/PassphraseDialog";
import { AuthFailedDialog } from "./components/AuthFailedDialog";
import { installSessionStream } from "./state/sessionStream";
import { onTransferStarted, onTransferProgress, onTransferDone, onTransferState } from "./ipc/transfers";
import { onTunnelStatus } from "./ipc/tunnels";
import { useTabHotkeys } from "./hooks/useTabHotkeys";
import type { HostInfo } from "./types/host";
import type { ActivityKind } from "./types/connection";

export function App() {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const setActive = useSessions((s) => s.setActive);
  const addSession = useSessions((s) => s.addSession);
  const removeSession = useSessions((s) => s.removeSession);
  const markSessionClosed = useSessions((s) => s.markSessionClosed);
  const activityBySession = useSessions((s) => s.activeActivity);
  const layout = useSessions((s) => s.layout);
  const setActivity = useSessions((s) => s.setActivity);
  const railView = useSessions((s) => s.railView);
  const toggleDrawer = useSessions((s) => s.toggleDrawer);
  // Which host the user most recently clicked to connect. Used to surface
  // ConnectingPanel even when another session is already active — clicking
  // an unconnected host deselects the current session and shows this panel.
  const [pendingConnectHostId, setPendingConnectHostId] = useState<string | null>(null);
  // Fallback: first host-id currently mid-connect (for the zero-session case
  // where pendingConnectHostId wasn't set, e.g. initial app launch).
  const connectingHostId = useSessions((s) => Object.keys(s.connecting)[0] ?? null);
  // Effective connecting host for label + ConnectingPanel display.
  const displayConnectingHostId = pendingConnectHostId ?? connectingHostId;
  const connectingHostLabel = useHostsStore((s) => {
    if (!displayConnectingHostId) return "";
    const h = s.hosts.find((x) => x.id === displayConnectingHostId);
    return h?.label ?? h?.host ?? displayConnectingHostId;
  });

  const hosts = useHostsStore((s) => s.hosts);
  const loadHosts = useHostsStore((s) => s.load);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  function modeOf(session: typeof activeSession): string {
    return hosts.find((h) => h.id === (session?.host_id ?? ""))?.connection_mode ?? "terminal_only";
  }

  /** Which activity a session's surface renders. Each pane switches its
   *  own now, so a terminal can sit beside a file browser. */
  function activityFor(sessionId: string): ActivityKind {
    const session = sessions.find((s) => s.id === sessionId) ?? null;
    return clampActivity(activityBySession[sessionId], activitiesFor(session, modeOf(session)));
  }

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
  const [importOpen, setImportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // In-app error banner. Replaces window.alert() which uses the OS's
  // native positioning (WebView2 opens it at the top-left of the app
  // window on Windows, floating disconnected from shellx's chrome).
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const passphraseReq = usePassphrase((s) => s.req);
  const [authFailed, setAuthFailed] = useState<{ host: HostInfo; message: string } | null>(null);

  useEffect(() => { void loadHosts(); }, [loadHosts]);

  // Load persisted settings once on mount. If none exist, the store's
  // DEFAULT_SETTINGS remain in effect.
  useEffect(() => {
    void useSettingsStore.getState().load().then(() => {
      if (useSettingsStore.getState().autoUpdateCheck) {
        void useUpdater.getState().check(true);
      }
    });
  }, []);

  // Wire the global session:data router. Buffers per-session bytes until a
  // TerminalView subscribes, so a freshly opened tab doesn't lose its
  // welcome banner + prompt to the mount-vs-Rust-pump race.
  useEffect(() => { installSessionStream(); }, []);

  // Sync themeId / density to <html data-*> attributes so tokens.css can
  // pick up the correct :root[data-…] variable block. Empty string on
  // "warm-minimal" / "comfortable" means "no attribute" → default block.
  useEffect(() => {
    const el = document.documentElement;
    if (themeId === "warm-light") delete el.dataset.theme; else el.dataset.theme = themeId;
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

  // Wire the backend's hostkey:challenge event into the challenges store so the
  // HostKeyDialog can prompt the user to accept or reject server host keys.
  useEffect(() => {
    let cancelled = false;
    let un: (() => void) | undefined;
    onHostkeyChallenge((c) => useChallenges.getState().push(c)).then((u) => {
      if (cancelled) { u(); return; }
      un = u;
    });
    return () => { cancelled = true; un?.(); };
  }, []);

  // Wire the backend's tunnel:status events into the sessions store so
  // the tunnel panel and activity toolbar can reflect live tunnel state.
  useEffect(() => {
    let cancelled = false;
    let un: (() => void) | undefined;
    onTunnelStatus((s) => useSessions.getState().setTunnelStatus(s.session_id, s)).then((u) => {
      if (cancelled) { u(); return; }
      un = u;
    });
    return () => { cancelled = true; un?.(); };
  }, []);

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

  async function attemptConnect(
    host: HostInfo,
    opts: { passphrase?: string; rememberPassphrase?: boolean }
  ) {
    const st = useSessions.getState();
    setPendingConnectHostId(host.id);
    st.beginConnecting(host.id);
    try {
      const info = await openConnection({
        host: host.host, port: host.port, username: host.username,
        password: "",
        label: host.label, host_id: host.id,
        auth_method: "publickey", key_path: host.key_path ?? undefined,
        passphrase: opts.passphrase,
      });
      if (opts.passphrase && opts.rememberPassphrase) {
        void setHostPassphrase(host.id, opts.passphrase);
      }
      usePassphrase.getState().clear();
      setPendingConnectHostId(null);
      addSession(info);
      // Set default activity based on connection_mode so tunnels_only sessions
      // open directly on the Tunnels tab instead of the (unavailable) Terminal.
      setActivity(info.id, host.connection_mode === "tunnels_only" ? "tunnel" : "terminal");
    } catch (e) {
      useSessions.getState().endConnecting(host.id);
      setPendingConnectHostId(null);
      const err = parseConnectError(e);
      if (err.kind === "passphrase-needed") {
        const nextAttempt = (usePassphrase.getState().req?.attempt ?? 0) + 1;
        if (nextAttempt > 3) {
          usePassphrase.getState().clear();
          setAuthFailed({ host, message: "passphrase 三次输入错误" });
        } else {
          usePassphrase.getState().push(host);
        }
      } else if (err.kind === "key-rejected") {
        setAuthFailed({ host, message: `Key rejected: ${err.detail}` });
      } else if (err.kind === "hostkey-declined") {
        // user declined fingerprint dialog — silent
      } else {
        setErrorMsg(`Connection failed: ${err.message}`);
      }
    }
  }

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
      // Already in-flight — surface the ConnectingPanel for this host.
      setPendingConnectHostId(host.id);
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

    if (host.auth_method === "publickey") {
      const storedPassphrase = await getHostPassphrase(host.id);
      void attemptConnect(host, { passphrase: storedPassphrase ?? undefined, rememberPassphrase: false });
      return;
    }

    // Password auth (original path)
    // Try to fetch password from keychain; if missing, prompt via ConnectDialog
    const password = await getHostPassword(host.id);
    if (!password) {
      // Fall back to edit-mode dialog so user can enter password once
      setDialog({ mode: "edit", initial: host });
      return;
    }
    setPendingConnectHostId(host.id);
    st.beginConnecting(host.id);
    try {
      const info = await openConnection({
        host: host.host, port: host.port,
        username: host.username, password,
        label: host.label,
        host_id: host.id,
      });
      setPendingConnectHostId(null);
      addSession(info);
      setActivity(info.id, host.connection_mode === "tunnels_only" ? "tunnel" : "terminal");
    } catch (e) {
      useSessions.getState().endConnecting(host.id);
      setPendingConnectHostId(null);
      setErrorMsg(`Connection failed: ${e}`);
    }
  }

  const tabs = sessions.map((s) => ({
    id: s.id, title: s.label, state: s.state, kind: s.kind, hostId: s.host_id,
  }));

  async function handleNewLocalTerminal() {
    try {
      const info = await openLocalTerminal();
      addSession(info);
      setActivity(info.id, "terminal");
    } catch (e) {
      setErrorMsg(`Failed to open local terminal: ${e}`);
    }
  }

  return (
    <>
      <AppShell
        tabs={tabs}
        activeTabId={activeId}
        onOpenPalette={() => setPaletteOpen(true)}
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
        onImportConfig={() => setImportOpen(true)}
        onNewLocalTerminal={() => void handleNewLocalTerminal()}
        onEditHost={(host) => setDialog({ mode: "edit", initial: host })}
        onConnectHost={(host, forceNew) => void handleConnectSavedHost(host, forceNew)}
        onRename={(id, title) => useSessions.getState().renameSession(id, title)}
      >
        {/* Tab body stays mounted whenever activeId exists — hide via
            display:none when the user is on a rail-level view (Files /
            Settings / Serial) so xterm state (scrollback, buffer,
            connection) survives round-trips, and live-reconfigure of
            terminal settings takes effect on the mounted xterm even
            while the Settings pane is being viewed. */}
        {activeId && (
          <div style={{
            display: (railView === "hosts" && !pendingConnectHostId) ? "flex" : "none",
            flexDirection: "column", height: "100%", minHeight: 0,
          }}>
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              {/* Panes. Each one is a box; the session bodies themselves
                  live in portalled surfaces below and get moved into the
                  right box, so a layout change never remounts an xterm. */}
              <PaneLayout />
            </div>
          </div>
        )}

        {railView === "hosts" && displayConnectingHostId && (
          // ConnectingPanel fills the main pane whenever a handshake is in
          // flight. Sessions div above stays mounted (display:none) so xterm
          // instances are never destroyed across tab switches. Cancel calls
          // endConnecting; if the in-flight openConnection succeeds anyway the
          // session still lands.
          <ConnectingPanel
            hostLabel={connectingHostLabel}
            onCancel={() => {
              if (displayConnectingHostId) {
                useSessions.getState().endConnecting(displayConnectingHostId);
              }
              setPendingConnectHostId(null);
            }}
          />
        )}
        {railView === "hosts" && !activeId && !displayConnectingHostId && (
          <EmptyState
            onNewConnection={() => setDialog({ mode: "create" })}
            onImportConfig={() => setImportOpen(true)}
          />
        )}
        {railView === "files" && (
          <RailFilesView onConnectSavedHost={(host) => void handleConnectSavedHost(host)} />
        )}
        {/* Always mounted, hidden on other views: the tunnel runtime
            state (rule → session map, retry timers, autostart-once
            guard) lives inside it, and unmounting dropped every running
            tunnel out of the UI while the forwarder stayed up. */}
        <GlobalTunnelsView hidden={railView !== "tunnels"} />
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
      {/* One portal per session, rendered once and never relocated by
          React — PaneLayout moves the host node instead. Lives outside
          AppShell so switching rail views can't unmount a terminal. */}
      <SessionSurfaces
        sessionIds={sessions.map((s) => s.id)}
        renderBody={(id) => {
          const session = sessions.find((s) => s.id === id) ?? null;
          const activity = activityFor(id);
          return (
            <>
              <div style={{ display: activity === "terminal" ? "block" : "none", height: "100%" }}>
                <TerminalView sessionId={id} />
              </div>
              <div style={{ display: activity === "files" ? "block" : "none", height: "100%" }}>
                <FileBrowserView connectionId={id} />
              </div>
              {activity === "tunnel" && (
                <div style={{ position: "absolute", inset: 0 }}>
                  <TunnelsPanel
                    sessionId={id}
                    hostId={session?.host_id ?? null}
                    connectionMode={modeOf(session)}
                  />
                </div>
              )}
              {activity === "monitor" && session?.kind === "ssh" && (
                <div style={{ position: "absolute", inset: 0 }}>
                  <MonitorBoundary>
                    <MonitorPanel connectionId={id} />
                  </MonitorBoundary>
                </div>
              )}
            </>
          );
        }}
      />
      <SshConfigImport open={importOpen} onClose={() => setImportOpen(false)} />
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
      <HostKeyDialog />
      {passphraseReq && (
        <PassphraseDialog
          open
          keyName={(passphraseReq.host.key_path ?? "").split(/[/\\]/).pop() ?? ""}
          attempt={passphraseReq.attempt}
          error={passphraseReq.error}
          onSubmit={(pp, remember) =>
            void attemptConnect(passphraseReq.host, { passphrase: pp, rememberPassphrase: remember })
          }
          onCancel={() => {
            useSessions.getState().endConnecting(passphraseReq.host.id);
            usePassphrase.getState().clear();
          }}
        />
      )}
      {authFailed && (
        <AuthFailedDialog
          message={authFailed.message}
          onUsePassword={() => { setAuthFailed(null); setDialog({ mode: "edit", initial: authFailed.host }); }}
          onPickAnotherKey={() => { setAuthFailed(null); setDialog({ mode: "edit", initial: authFailed.host }); }}
          onRetry={() => { const h = authFailed.host; setAuthFailed(null); void attemptConnect(h, {}); }}
          onClose={() => setAuthFailed(null)}
        />
      )}
    </>
  );
}

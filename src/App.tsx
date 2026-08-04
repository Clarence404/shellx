import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { TerminalView } from "./components/TerminalView";
import { ActivityToolbar } from "./components/ActivityToolbar";
import { FileBrowserView } from "./components/FileBrowserView";
import { ConnectDialog } from "./components/ConnectDialog";
import { CommandPalette } from "./components/CommandPalette";
import { useSessions } from "./state/sessions";
import { useHostsStore } from "./state/hosts";
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

  const loadHosts = useHostsStore((s) => s.load);

  const [dialog, setDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; initial: HostInfo }
    | null
  >(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => { void loadHosts(); }, [loadHosts]);

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
    onTransferDone((ev) => store.applyDone(ev)).then((u) => {
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
        onNewConnection={() => setDialog({ mode: "create" })}
        onEditHost={(host) => setDialog({ mode: "edit", initial: host })}
        onConnectHost={(host) => void handleConnectSavedHost(host)}
      >
        {activeId ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <ActivityToolbar
              activity={activeActivity}
              onChange={(a) => setActivity(activeId, a)}
            />
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              {/* Both mounted; only one visible — keeps xterm state alive across tab switches */}
              <div style={{ display: activeActivity === "terminal" ? "block" : "none", height: "100%" }}>
                <TerminalView sessionId={activeId} />
              </div>
              <div style={{ display: activeActivity === "files" ? "block" : "none", height: "100%" }}>
                <FileBrowserView connectionId={activeId} />
              </div>
            </div>
          </div>
        ) : (
          <EmptyState onNewConnection={() => setDialog({ mode: "create" })} />
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

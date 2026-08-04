import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { TerminalView } from "./components/TerminalView";
import { ActivityToolbar } from "./components/ActivityToolbar";
import { ConnectDialog } from "./components/ConnectDialog";
import { CommandPalette } from "./components/CommandPalette";
import { useSessions } from "./state/sessions";
import { useHostsStore } from "./state/hosts";
import { closeSession, openConnection } from "./ipc/commands";
import { getHostPassword } from "./ipc/hosts";
import { useTabHotkeys } from "./hooks/useTabHotkeys";
import type { HostInfo } from "./types/host";

export function App() {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const setActive = useSessions((s) => s.setActive);
  const addSession = useSessions((s) => s.addSession);
  const removeSession = useSessions((s) => s.removeSession);
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
    // Try to fetch password from keychain; if missing, prompt via ConnectDialog
    const password = await getHostPassword(host.id);
    if (!password) {
      // Fall back to edit-mode dialog so user can enter password once
      setDialog({ mode: "edit", initial: host });
      return;
    }
    try {
      const info = await openConnection({
        host: host.host, port: host.port,
        username: host.username, password,
        label: host.label,
        host_id: host.id,
      });
      addSession(info);
    } catch (e) {
      alert(`Connection failed: ${e}`);
    }
  }

  const tabs = sessions.map((s) => ({ id: s.id, title: s.label }));

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
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <ActivityToolbar
              activity={activeActivity}
              onChange={(a) => setActivity(activeId, a)}
            />
            <div style={{ flex: 1, position: "relative" }}>
              {/* Both mounted; only one visible — keeps xterm state alive across tab switches */}
              <div style={{ display: activeActivity === "terminal" ? "block" : "none", height: "100%" }}>
                <TerminalView sessionId={activeId} />
              </div>
              <div style={{ display: activeActivity === "files" ? "block" : "none", height: "100%" }}>
                {/* FileBrowserView is added in Task 8 — for now a placeholder */}
                <div style={{ padding: 20, color: "var(--text-3)" }}>Files view (Task 8 fills this in)</div>
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

import { useEffect, useState } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { TerminalView } from "./components/TerminalView";
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
      addSession({
        id: info.id, label: info.label,
        kind: "ssh", host_id: info.host_id,
      });
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
          <TerminalView sessionId={activeId} />
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

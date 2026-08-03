import { useState } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { TerminalView } from "./components/TerminalView";
import { ConnectDialog } from "./components/ConnectDialog";
import { useSessions } from "./state/sessions";
import { closeSession } from "./ipc/commands";

export function App() {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const setActive = useSessions((s) => s.setActive);
  const removeSession = useSessions((s) => s.removeSession);
  const [dialogOpen, setDialogOpen] = useState(false);

  const tabs = sessions.map((s) => ({ id: s.id, title: s.label }));

  return (
    <>
      <AppShell
        tabs={tabs}
        activeTabId={activeId}
        onTabSelect={setActive}
        onTabClose={(id) => { void closeSession(id); removeSession(id); }}
        onNewConnection={() => setDialogOpen(true)}
      >
        {activeId ? (
          <TerminalView sessionId={activeId} />
        ) : (
          <EmptyState onNewConnection={() => setDialogOpen(true)} />
        )}
      </AppShell>
      <ConnectDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}

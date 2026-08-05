import { useEffect, useState } from "react";
import { LocalPane } from "./LocalPane";
import { RemotePane } from "./RemotePane";
import { TransferQueue } from "./TransferQueue";
import { ConnectDialog } from "./ConnectDialog";
import { useSessions } from "../state/sessions";
import { useRailFiles } from "../state/railFiles";

export function RailFilesView() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const sessionCount = useSessions((s) => s.sessions.length);

  // Auto-select the newly-connected host as the remote pane's host whenever
  // the session list grows (e.g. after ConnectDialog resolves a connection).
  // Read sessions fresh via getState() rather than trusting a stale closure
  // over the array captured at render time.
  const [prevCount, setPrevCount] = useState(sessionCount);
  useEffect(() => {
    if (sessionCount > prevCount) {
      const sessions = useSessions.getState().sessions;
      const newest = sessions[sessions.length - 1];
      if (newest) void useRailFiles.getState().setRightHost(newest.id);
    }
    setPrevCount(sessionCount);
  }, [sessionCount, prevCount]);

  return (
    <div data-testid="rail-files-view"
      style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column",
        background: "var(--panel-2)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexBasis: "50%", minWidth: 0, borderRight: "0.5px solid var(--border)" }}>
          <LocalPane />
        </div>
        <div style={{ flexBasis: "50%", minWidth: 0 }}>
          <RemotePane onNewConnection={() => setDialogOpen(true)} />
        </div>
      </div>
      <TransferQueue showAll />
      <ConnectDialog open={dialogOpen} mode="create" onClose={() => setDialogOpen(false)} />
    </div>
  );
}

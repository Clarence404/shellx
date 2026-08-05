import { useEffect, useState } from "react";
import { LocalPane } from "./LocalPane";
import { RemotePane } from "./RemotePane";
import { TransferQueue } from "./TransferQueue";
import { ConnectDialog } from "./ConnectDialog";
import { PaneSplitter } from "./PaneSplitter";
import { TransferArrow } from "./TransferArrow";
import { useSessions } from "../state/sessions";
import { useRailFiles } from "../state/railFiles";
import type { HostInfo } from "../types/host";

interface Props {
  onConnectSavedHost?: (host: HostInfo) => void;
}

export function RailFilesView({ onConnectSavedHost }: Props = {}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const sessionCount = useSessions((s) => s.sessions.length);
  const rightHost = useRailFiles((s) => s.rightHost);
  const splitterPercent = useRailFiles((s) => s.splitterPercent);
  const setSplitterDraft = useRailFiles((s) => s.setSplitterDraft);
  const setSplitter = useRailFiles((s) => s.setSplitter);

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

  // Fallback for the case the growth effect above can't observe: this view
  // unmounts entirely when railView !== "files" (App.tsx renders it
  // conditionally, not just hidden), so a host connected while the user was
  // on the Hosts view (via its own ConnectDialog flow) never registers as
  // sessionCount "growing" here — prevCount just reseeds fresh on remount.
  // Guarding on `!rightHost && activeId` means this can only fire once, on
  // the null -> non-null transition: as soon as setRightHost runs (from
  // here, from the effect above, or from a manual pick), rightHost becomes
  // non-null and the guard blocks any further re-firing, so it can't clobber
  // a deliberate host switch made later (e.g. by clicking between tabs).
  const activeId = useSessions((s) => s.activeId);
  useEffect(() => {
    if (!rightHost && activeId) void useRailFiles.getState().setRightHost(activeId);
  }, [activeId, rightHost]);

  return (
    <div data-testid="rail-files-view"
      style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column",
        background: "var(--panel-2)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        <div style={{ flexBasis: `${splitterPercent}%`, minWidth: 0, borderRight: "0.5px solid var(--border)" }}>
          <LocalPane />
        </div>
        <PaneSplitter percent={splitterPercent} onChange={setSplitterDraft} onCommit={setSplitter} />
        <div style={{ flexBasis: `${100 - splitterPercent}%`, minWidth: 0 }}>
          <RemotePane
            onNewConnection={() => setDialogOpen(true)}
            onConnectSavedHost={onConnectSavedHost}
          />
        </div>
        <TransferArrow />
      </div>
      <TransferQueue showAll />
      <ConnectDialog open={dialogOpen} mode="create" onClose={() => setDialogOpen(false)} />
    </div>
  );
}

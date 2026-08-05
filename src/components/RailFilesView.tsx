import { TransferQueue } from "./TransferQueue";
import { LocalPane } from "./LocalPane";

export function RailFilesView() {
  return (
    <div data-testid="rail-files-view"
      style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column",
        background: "var(--panel-2)", color: "var(--text-2)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flexBasis: "50%", minWidth: 0, borderRight: "0.5px solid var(--border)" }}>
          <LocalPane />
        </div>
        <div style={{ flexBasis: "50%", minWidth: 0, background: "var(--panel-1)",
          color: "var(--text-3)", fontSize: 11, padding: 12 }}>
          Remote pane in the next task
        </div>
      </div>
      <TransferQueue showAll />
    </div>
  );
}

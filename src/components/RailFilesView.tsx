import { TransferQueue } from "./TransferQueue";

export function RailFilesView() {
  return (
    <div data-testid="rail-files-view"
      style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column",
        background: "var(--panel-2)", color: "var(--text-2)" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 12 }}>
        Rail Files — panes coming up in the next tasks
      </div>
      <TransferQueue showAll />
    </div>
  );
}

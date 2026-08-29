import { useCallback, useRef } from "react";
import { TransferBar, TransferRows, useHasVisibleTransfers } from "./TransferQueue";
import { useRailFiles } from "../state/railFiles";

interface Props {
  /** Scope the strip to a single connection (FileBrowserView) or show
   *  every transfer across the app (RailFilesView / FtpView with
   *  `showAll`). Exactly one should be set. */
  connectionId?: string;
  showAll?: boolean;
}

/**
 * The bottom transfer strip: one bar, two states. Collapsed it is the
 * bar alone — 28 px, totals painted into its background. Expanded, the
 * rows panel grows out underneath, capped at 40% of the window, with a
 * drag handle on top. The bar itself is the expand/collapse toggle, and
 * both the expanded flag and the dragged height live in `useRailFiles`
 * so the three surfaces that render this (the Files rail view, the
 * per-tab Files activity, the FTP view) stay in step.
 */
export function TransferStripSection({ connectionId, showAll }: Props) {
  const hasTransfers = useHasVisibleTransfers(connectionId, showAll);
  const expanded = useRailFiles((s) => s.transfersExpanded);
  const toggle = useRailFiles((s) => s.toggleTransfersExpanded);
  const height = useRailFiles((s) => s.transferStripHeight);
  const setDraft = useRailFiles((s) => s.setTransferStripHeightDraft);
  const setCommit = useRailFiles((s) => s.setTransferStripHeight);

  const dragStartRef = useRef<{ startY: number; startH: number } | null>(null);
  const onSplitterMouseDown = useCallback((ev: React.MouseEvent) => {
    ev.preventDefault();
    dragStartRef.current = { startY: ev.clientY, startH: height };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (me: MouseEvent) => {
      const s = dragStartRef.current;
      if (!s) return;
      // Cursor moves down → strip should shrink, so subtract the delta.
      setDraft(s.startH - (me.clientY - s.startY));
    };
    const onUp = () => {
      const s = dragStartRef.current;
      dragStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (s) setCommit(useRailFiles.getState().transferStripHeight);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [height, setDraft, setCommit]);

  if (!hasTransfers) return null;

  return (
    <div style={{
      display: "flex", flexDirection: "column", flexShrink: 0,
      boxShadow: "0 -3px 10px rgba(15, 23, 42, 0.06)",
      borderTop: "1px solid var(--border)",
    }}>
      {expanded && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize"
          onMouseDown={onSplitterMouseDown}
          style={{
            height: 6, flexShrink: 0, cursor: "row-resize",
            background: "var(--border)",
          }}
        />
      )}
      <TransferBar
        connectionId={connectionId}
        showAll={showAll}
        expanded={expanded}
        onToggle={toggle}
      />
      {expanded && (
        <div style={{ height, minHeight: 0, flexShrink: 0 }}>
          <TransferRows connectionId={connectionId} showAll={showAll} />
        </div>
      )}
    </div>
  );
}

import { useCallback, useMemo, useRef } from "react";
import { TransferQueue, useHasVisibleTransfers } from "./TransferQueue";
import { useRailFiles } from "../state/railFiles";
import { useTransfersStore } from "../state/transfers";

interface Props {
  /** Scope the strip to a single connection (FileBrowserView) or
   *  show every transfer across the app (RailFilesView with
   *  `showAll`). Exactly one should be set — same shape as the
   *  TransferQueue props themselves. */
  connectionId?: string;
  showAll?: boolean;
}

/** Bottom transfer strip + horizontal drag handle, shared between
 *  RailFilesView and FileBrowserView. Height + group-expand state
 *  live in `useRailFiles` so a user's dragged size and expand
 *  toggles carry across both views.
 *
 *  Behaviour:
 *   - Collapsed (no group expanded): 36 px strip that hugs the
 *     parent's bottom edge, no drag handle.
 *   - Expanded: strip grows to `useRailFiles.transferStripHeight`
 *     (persisted). A 6 px `row-resize` handle sits above it; drag
 *     up / down mutates that height live.
 *   - No visible transfers: renders nothing so no empty gap. */
export function TransferStripSection({ connectionId, showAll }: Props) {
  const transferStripHeight = useRailFiles((s) => s.transferStripHeight);
  const setDraft = useRailFiles((s) => s.setTransferStripHeightDraft);
  const setCommit = useRailFiles((s) => s.setTransferStripHeight);
  const transferGroupExpandedMap = useRailFiles((s) => s.transferGroupExpanded);
  const transfersList = useTransfersStore((s) => s.list);
  const hasTransfers = useHasVisibleTransfers(connectionId, showAll);

  // Only groups with an actively-transferring child hold the strip open —
  // stale expand entries from finished groups don't count.
  const anyGroupExpanded = useMemo(() => {
    for (const t of transfersList) {
      const inScope = showAll || t.connection_id === connectionId;
      if (!inScope) continue;
      if (
        t.groupId
        && transferGroupExpandedMap[t.groupId]
        && (t.state.kind === "queued" || t.state.kind === "active" || t.state.kind === "paused")
      ) {
        return true;
      }
    }
    return false;
  }, [transfersList, transferGroupExpandedMap, connectionId, showAll]);

  // 5 px top + 5 px bottom padding + 26 px ProgressRow = 36 px exactly.
  const COMPACT_HEIGHT = 36;
  const effectiveHeight = anyGroupExpanded ? transferStripHeight : COMPACT_HEIGHT;
  const showDivider = anyGroupExpanded;

  const dragStartRef = useRef<{ startY: number; startH: number } | null>(null);
  const onSplitterMouseDown = useCallback((ev: React.MouseEvent) => {
    ev.preventDefault();
    dragStartRef.current = { startY: ev.clientY, startH: transferStripHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (me: MouseEvent) => {
      const s = dragStartRef.current;
      if (!s) return;
      const dy = me.clientY - s.startY;
      // Cursor moves down → strip should SHRINK, so subtract dy.
      setDraft(s.startH - dy);
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
  }, [transferStripHeight, setDraft, setCommit]);

  if (!hasTransfers) return null;
  return (
    <>
      {showDivider && (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Drag to resize"
          onMouseDown={onSplitterMouseDown}
          style={{
            height: 6, flexShrink: 0,
            cursor: "row-resize",
            background: "var(--border)",
            borderTop: "0.5px solid var(--border)",
            borderBottom: "0.5px solid var(--border)",
          }}
        />
      )}
      <div style={{ height: effectiveHeight, minHeight: 0, flexShrink: 0 }}>
        <TransferQueue
          connectionId={connectionId}
          showAll={showAll}
          scrollable={anyGroupExpanded}
        />
      </div>
    </>
  );
}

import { memo } from "react";
import { X, ChevronRight, ChevronDown, Folder, ArrowUp, ArrowDown, Pause, Play } from "lucide-react";
import { useTransfersStore } from "../state/transfers";
import { useRailFiles } from "../state/railFiles";
import type { TransferInfo } from "../types/sftp";

// Route pause / resume / cancel through the store (not the raw IPC
// wrappers) so the optimistic UI flip fires before Rust confirms.
const cancelTransfer = (id: string) => void useTransfersStore.getState().cancel(id);
const cancelGroupTransfer = (groupId: string) => void useTransfersStore.getState().cancelGroup(groupId);
const pauseTransfer = (id: string) => void useTransfersStore.getState().pause(id);
const resumeTransfer = (id: string) => void useTransfersStore.getState().resume(id);

interface Props {
  connectionId?: string;
  showAll?: boolean;  // when true, skip the connectionId filter and list every transfer
  /** When `false` the outer container's overflow is `hidden` — used by
   *  RailFilesView while the strip is in the compact (all-collapsed)
   *  state so Windows' rendered-scrollbar-gutter doesn't leave a
   *  vertical stripe on the right of a single-row header. Auto by
   *  default so the standalone FileBrowserView keeps a scrollbar. */
  scrollable?: boolean;
  /** `"fill"` (default) → outer uses `height: 100%` so the parent
   *  can dictate size — RailFilesView wraps in a fixed-height div
   *  and gets exactly that many pixels.
   *  `"content"` → outer sizes to content up to the parent's
   *  `max-height`, letting the strip hug the bottom of a page like
   *  FileBrowserView where the wrapper has no fixed height. */
  sizingMode?: "fill" | "content";
}

interface GroupEntry {
  kind: "group";
  groupId: string;
  direction: "upload" | "download";
  label: string;                // best-effort folder name for the group
  totalBytes: number;           // summed over ALL children (queued+active+done)
  bytesDone: number;
  totalFiles: number;
  doneFiles: number;
  activeFiles: number;
  queuedFiles: number;
  pausedFiles: number;
  childIds: string[];           // for bulk cancel
  hasFailed: boolean;
}

interface SoloEntry {
  kind: "solo";
  transfer: TransferInfo;
}

/** Returns `true` when the TransferQueue for the same (connectionId,
 *  showAll) inputs would render content. Callers use it to decide
 *  whether to render surrounding chrome (a resize splitter, a fixed-
 *  height wrapper) that would otherwise sit above an empty strip.
 *
 *  Mirrors TransferQueue's own visibility rules exactly:
 *   - Solo transfers (no groupId): visible unless cancelled — done and
 *     failed linger for the `applyDone`-scheduled 5 s removal so a fast
 *     OS drop doesn't just flash by unnoticed.
 *   - Grouped transfers: the group is visible only while at least one
 *     child is queued / active / paused. Done-only or all-cancelled
 *     groups drop out immediately so a leftover group with no active
 *     work doesn't hold an empty compact strip open. */
export function useHasVisibleTransfers(connectionId?: string, showAll?: boolean): boolean {
  return useTransfersStore((s) => {
    const scoped = showAll
      ? s.list
      : s.list.filter((t) => t.connection_id === connectionId);
    for (const t of scoped) {
      if (!t.groupId) {
        if (t.state.kind !== "cancelled") return true;
      }
    }
    const activeGroupIds = new Set<string>();
    for (const t of scoped) {
      if (
        t.groupId
        && (t.state.kind === "queued" || t.state.kind === "active" || t.state.kind === "paused")
      ) {
        activeGroupIds.add(t.groupId);
      }
    }
    return activeGroupIds.size > 0;
  });
}

export function TransferQueue({ connectionId, showAll, scrollable = true, sizingMode = "fill" }: Props) {
  const allTransfers = useTransfersStore((s) => s.list);
  // Expand state lives in `useRailFiles` so RailFilesView can subscribe
  // and auto-lift the strip's height when any group opens (see the
  // transferStripMode logic there). Session-scoped, not persisted.
  const expanded = useRailFiles((s) => s.transferGroupExpanded);
  const setExpanded = useRailFiles((s) => s.setTransferGroupExpanded);
  // Aggregate children with the same groupId into one row; ungrouped
  // transfers each get their own row. A dir-upload of 30 files now shows
  // ONE line ("↑ project/  4/30 files  12/240 MB") instead of thirty.
  const scoped = showAll
    ? allTransfers
    : allTransfers.filter((t) => t.connection_id === connectionId);

  const groups = new Map<string, GroupEntry>();
  const solos: SoloEntry[] = [];
  for (const t of scoped) {
    if (t.groupId) {
      let g = groups.get(t.groupId);
      if (!g) {
        g = {
          kind: "group",
          groupId: t.groupId,
          direction: t.direction,
          label: dirLabel(t),
          totalBytes: 0,
          bytesDone: 0,
          totalFiles: 0,
          doneFiles: 0,
          activeFiles: 0,
          queuedFiles: 0,
          pausedFiles: 0,
          childIds: [],
          hasFailed: false,
        };
        groups.set(t.groupId, g);
      }
      g.totalFiles += 1;
      g.totalBytes += t.total_bytes;
      g.bytesDone += t.bytes_done;
      g.childIds.push(t.id);
      if (t.state.kind === "done") g.doneFiles += 1;
      if (t.state.kind === "active") g.activeFiles += 1;
      if (t.state.kind === "queued") g.queuedFiles += 1;
      if (t.state.kind === "paused") g.pausedFiles += 1;
      if (t.state.kind === "failed") g.hasFailed = true;
    } else if (t.state.kind !== "cancelled") {
      // Solo rows include done / failed too — they linger for the
      // 5 s `applyDone`-scheduled removal so a fast OS drop doesn't
      // flash the strip past too briefly to notice.
      solos.push({ kind: "solo", transfer: t });
    }
  }

  // Show groups while ANY child is still queued, active, or paused.
  // All-terminal groups (all done / cancelled / failed) drop out — T3's
  // Transfers view surfaces them in history instead.
  const visibleGroups = Array.from(groups.values()).filter(
    (g) => g.queuedFiles > 0 || g.activeFiles > 0 || g.pausedFiles > 0,
  );
  if (visibleGroups.length === 0 && solos.length === 0) return null;

  return (
    <div
      className="shellx-transfer-scroll"
      style={{
        // No borderTop — the `--panel-1` (strip) vs `--panel-2` (panes)
        // fill difference already reads as a boundary, and a hairline
        // border here made the visual "above-row" space feel 1 px
        // taller than the "below-row" padding no matter how we tuned it.
        // Symmetric 5 px vertical, tight 4 px horizontal — row rules
        // the horizontal inset with its own internal `padding: "4px 8px"`.
        padding: "5px 4px",
        background: "var(--panel-1)", display: "flex", flexDirection: "column", gap: 4,
        minHeight: 0,
        // `fill`: RailFilesView wraps us in a fixed-height div and we
        // fill it exactly (used by both the compact single-header
        // state and the user-dragged expanded state).
        // `content`: FileBrowserView wants us to hug the bottom of
        // the page — size to content but cap at parent's max-height
        // so a multi-file transfer can't push the toolbar off screen.
        ...(sizingMode === "fill"
          ? { height: "100%" }
          : { maxHeight: "100%" }),
        overflowY: scrollable ? "auto" : "hidden",
      }}
    >
      {visibleGroups.map((g) => {
        const pct = g.totalBytes > 0 ? (g.bytesDone / g.totalBytes) * 100 : 0;
        const isOpen = !!expanded[g.groupId];
        const children = scoped.filter((t) => t.groupId === g.groupId);
        return (
          <div key={`g:${g.groupId}`} style={{ display: "flex", flexDirection: "column" }}>
            {/* Sticky header: while the user scrolls a long expanded
                child list, the group's ProgressRow stays pinned so
                bytes-done / cancel / pause controls are always
                reachable. `top: 5` matches the outer's 5 px
                `paddingTop` — the header preserves its natural gap
                from the strip's top edge even while scrolling. The
                outer scroll container's own `--panel-1` background
                fills the strip's top 5 px so nothing appears to bleed
                through above the header. */}
            <div style={{
              position: "sticky", top: 5, zIndex: 2,
              background: "var(--panel-1)",
            }}>
              <ProgressRow
              pct={pct}
              failed={g.hasFailed}
              paused={g.pausedFiles > 0 && g.activeFiles === 0}
              onPause={g.activeFiles > 0 ? (ev) => {
                ev.stopPropagation();
                for (const id of g.childIds) pauseTransfer(id);
              } : undefined}
              onResume={g.pausedFiles > 0 ? (ev) => {
                ev.stopPropagation();
                for (const id of g.childIds) resumeTransfer(id);
              } : undefined}
              onCancel={(ev) => {
                ev.stopPropagation();
                // Single Rust IPC — cancels every existing child AND
                // stops mid-enumeration spawns (the 2500-file case).
                // The N-per-child loop couldn't do the second half.
                cancelGroupTransfer(g.groupId);
              }}
            >
              <button
                onClick={() => setExpanded(g.groupId, !isOpen)}
                title={isOpen ? "Collapse" : "Expand"}
                style={{
                  background: "transparent", border: "none",
                  padding: 0, cursor: "pointer", display: "inline-flex",
                  color: "var(--text-2)", flexShrink: 0,
                }}
              >
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <DirectionArrow dir={g.direction} />
              <Folder size={13} color="var(--text-2)" />
              <span style={{
                color: "var(--text-1)", flex: 1, minWidth: 0,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{g.label}</span>
              <span style={{ color: "var(--text-2)", fontSize: 10, flexShrink: 0 }}>
                {g.doneFiles}/{g.totalFiles} files
              </span>
              <span style={{ color: "var(--text-2)", fontSize: 10, minWidth: 110, textAlign: "right", flexShrink: 0 }}>
                {formatSize(g.bytesDone)} / {formatSize(g.totalBytes)} · {Math.round(pct)}%
              </span>
            </ProgressRow>
            </div>
            {isOpen && (
              <div style={{
                // No hanging indent — child rows line up with the group
                // header's outer edge, matching every other list row in
                // the panes above. The previous `marginLeft: 22` tree-
                // guide looked awkward inside such a narrow strip.
                display: "flex", flexDirection: "column", gap: 3, marginTop: 4, marginBottom: 4,
                // No inner maxHeight either — the OUTER TransferQueue owns
                // the scroll (overflowY: auto up top), so the expanded
                // list grows to fit whatever height the user has dragged
                // the strip to.
              }}>
                {children.map((t) => <ChildRow key={t.id} t={t} />)}
              </div>
            )}
          </div>
        );
      })}
      {solos.map(({ transfer: t }) => {
        const pct = t.total_bytes > 0 ? (t.bytes_done / t.total_bytes) * 100 : 0;
        const isPaused = t.state.kind === "paused";
        const isRunning = t.state.kind === "active" || t.state.kind === "queued";
        return (
          <ProgressRow
            key={t.id}
            pct={pct}
            failed={t.state.kind === "failed"}
            paused={isPaused}
            onPause={isRunning ? (ev) => { ev.stopPropagation(); pauseTransfer(t.id); } : undefined}
            onResume={isPaused ? (ev) => { ev.stopPropagation(); resumeTransfer(t.id); } : undefined}
            onCancel={(ev) => { ev.stopPropagation(); cancelTransfer(t.id); }}
          >
            <DirectionArrow dir={t.direction} />
            <span style={{
              color: "var(--text-1)", flex: 1, minWidth: 0,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {t.remote_path.split(/[\\/]/).pop()}
            </span>
            <span style={{ color: "var(--text-2)", fontSize: 10, minWidth: 130, textAlign: "right", flexShrink: 0 }}>
              {t.state.kind === "queued" && t.bytes_done === 0
                ? "queued"
                : `${formatSize(t.bytes_done)} / ${formatSize(t.total_bytes)} · ${Math.round(pct)}%${isPaused ? " · paused" : ""}`}
            </span>
          </ProgressRow>
        );
      })}
    </div>
  );
}

/** Row rendered with a full-width progress fill as the background — the
 *  filled portion tints the row from left to right as bytes advance. The
 *  children (icons, filename, size counter) sit on top of the fill via
 *  a relative wrapper. Same visual for group headers and solo transfers.
 *  When paused, the fill turns amber; when failed, red. */
function ProgressRow({
  pct, failed, paused, onPause, onResume, onCancel, children,
}: {
  pct: number;
  failed: boolean;
  paused?: boolean;
  onPause?: (ev: React.MouseEvent) => void;
  onResume?: (ev: React.MouseEvent) => void;
  onCancel: (ev: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const fillColor = failed
    ? "rgba(242, 135, 121, 0.28)"
    : paused
    ? "rgba(242, 200, 162, 0.22)"
    : "var(--accent-fade)";
  return (
    <div style={{
      position: "relative", overflow: "hidden",
      borderRadius: 4,
      background: "var(--panel-2)",
      border: "0.5px solid var(--border)",
      minHeight: 26,
    }}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: fillColor,
          transition: "width 200ms linear",
        }}
      />
      <div style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: 8,
        padding: "4px 8px", fontSize: 11,
      }}>
        {children}
        {onResume && (
          <button onClick={onResume} title="Resume" style={iconBtnStyle}>
            <Play size={13} color="var(--text-1)" />
          </button>
        )}
        {onPause && !onResume && (
          <button onClick={onPause} title="Pause" style={iconBtnStyle}>
            <Pause size={13} color="var(--text-1)" />
          </button>
        )}
        <button onClick={onCancel} title="Cancel" style={iconBtnStyle}>
          <X size={13} color="var(--text-1)" />
        </button>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  background: "transparent", border: "none",
  cursor: "pointer", padding: 4, flexShrink: 0,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};

// Memoized so that a directory-transfer's 500 child rows don't ALL
// re-render on every progress tick. `useTransfersStore.applyProgress`
// only ever creates a new `TransferInfo` object for the one child whose
// bytes advanced; every other child keeps its previous reference, so
// React.memo's shallow prop compare skips the render for them entirely.
// Without this, expanding a large group made the pane visibly stutter
// under progress-event storms.
const ChildRow = memo(function ChildRow({ t }: { t: TransferInfo }) {
  const name = t.remote_path.split(/[\\/]/).pop() ?? "";
  const pct = t.total_bytes > 0 ? (t.bytes_done / t.total_bytes) * 100 : 0;
  const isActive = t.state.kind === "active";
  const isFailed = t.state.kind === "failed";
  return (
    <div style={{
      position: "relative", overflow: "hidden",
      borderRadius: 3, minHeight: 20,
      // Terminal children keep the border only — no background fill so
      // they visually recede against active siblings.
      background: "transparent",
    }}>
      {isActive && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${Math.max(0, Math.min(100, pct))}%`,
            background: "var(--accent-fade)",
            transition: "width 200ms linear",
          }}
        />
      )}
      <div style={{
        position: "relative",
        display: "flex", alignItems: "center", gap: 8,
        padding: "3px 6px", fontSize: 10,
      }}>
        <span style={{
          color: "var(--text-2)", flex: 1, minWidth: 0,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{name}</span>
        {isActive && (
          <span style={{ color: "var(--text-2)", minWidth: 140, textAlign: "right", flexShrink: 0 }}>
            {formatSize(t.bytes_done)} / {formatSize(t.total_bytes)} · {Math.round(pct)}%
          </span>
        )}
        {t.state.kind === "queued" && (
          <span style={{ color: "var(--text-3)", flexShrink: 0 }}>queued</span>
        )}
        {t.state.kind === "paused" && (
          <span style={{ color: "var(--warn)", flexShrink: 0 }}>paused</span>
        )}
        {t.state.kind === "done" && (
          <span style={{ color: "var(--success)", flexShrink: 0 }}>done</span>
        )}
        {t.state.kind === "cancelled" && (
          <span style={{ color: "var(--text-3)", flexShrink: 0 }}>cancelled</span>
        )}
        {isFailed && (
          <span style={{ color: "var(--error)", flexShrink: 0 }} title={(t.state as { error: string }).error}>failed</span>
        )}
      </div>
    </div>
  );
});

function DirectionArrow({ dir }: { dir: "upload" | "download" }) {
  return dir === "upload"
    ? <ArrowUp size={11} color="var(--text-3)" />
    : <ArrowDown size={11} color="var(--text-3)" />;
}

function dirLabel(t: TransferInfo): string {
  // Best-effort group label: parent-folder basename of the FIRST child's
  // destination path. For an upload the local path's parent gives the
  // group's own name (e.g. "project" for "…/project/src/main.rs");
  // downloads mirror by using the remote path's parent.
  const src = t.direction === "upload" ? t.remote_path : t.local_path;
  const parts = src.split(/[\\/]/).filter(Boolean);
  // Group root is typically the second-to-last segment (child file's
  // parent). Fall back to the last if the path is shallow.
  return parts[parts.length - 2] ?? parts[parts.length - 1] ?? "(unknown)";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

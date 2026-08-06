import { useState } from "react";
import { X, ChevronRight, ChevronDown, Folder, ArrowUp, ArrowDown, Pause, Play } from "lucide-react";
import { useTransfersStore } from "../state/transfers";
import { transferCancel, transferPause, transferResume } from "../ipc/transfers";
import type { TransferInfo } from "../types/sftp";

interface Props {
  connectionId?: string;
  showAll?: boolean;  // when true, skip the connectionId filter and list every transfer
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

export function TransferQueue({ connectionId, showAll }: Props) {
  const allTransfers = useTransfersStore((s) => s.list);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
    } else if (t.state.kind === "queued" || t.state.kind === "active" || t.state.kind === "paused") {
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
    <div style={{
      borderTop: "1px solid var(--border)", padding: "6px 10px",
      background: "var(--panel-1)", display: "flex", flexDirection: "column", gap: 4,
      // Cap the whole strip so a group with 100 children (each row
      // rendered on expand) can't push everything else off screen —
      // scroll inside instead. ~36 vh keeps at least 60 % of the pane
      // for the file browser above.
      maxHeight: "36vh", overflowY: "auto",
    }}>
      {visibleGroups.map((g) => {
        const pct = g.totalBytes > 0 ? (g.bytesDone / g.totalBytes) * 100 : 0;
        const isOpen = !!expanded[g.groupId];
        const children = scoped.filter((t) => t.groupId === g.groupId);
        return (
          <div key={`g:${g.groupId}`} style={{ display: "flex", flexDirection: "column" }}>
            <ProgressRow
              pct={pct}
              failed={g.hasFailed}
              paused={g.pausedFiles > 0 && g.activeFiles === 0}
              onPause={g.activeFiles > 0 ? (ev) => {
                ev.stopPropagation();
                for (const id of g.childIds) void transferPause(id);
              } : undefined}
              onResume={g.pausedFiles > 0 ? (ev) => {
                ev.stopPropagation();
                for (const id of g.childIds) void transferResume(id);
              } : undefined}
              onCancel={(ev) => {
                ev.stopPropagation();
                for (const id of g.childIds) void transferCancel(id);
              }}
            >
              <button
                onClick={() => setExpanded((m) => ({ ...m, [g.groupId]: !m[g.groupId] }))}
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
            {isOpen && (
              <div style={{
                marginLeft: 22, paddingLeft: 10, borderLeft: "0.5px solid var(--border)",
                display: "flex", flexDirection: "column", gap: 3, marginTop: 4, marginBottom: 4,
                // Cap the expanded children list — a 500-file directory
                // upload would otherwise render 500 rows inline and the
                // outer strip would run the whole pane. Scroll inside.
                maxHeight: 200, overflowY: "auto",
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
            onPause={isRunning ? (ev) => { ev.stopPropagation(); void transferPause(t.id); } : undefined}
            onResume={isPaused ? (ev) => { ev.stopPropagation(); void transferResume(t.id); } : undefined}
            onCancel={(ev) => { ev.stopPropagation(); void transferCancel(t.id); }}
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

function ChildRow({ t }: { t: TransferInfo }) {
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
}

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

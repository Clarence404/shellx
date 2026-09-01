import { useMemo } from "react";
import { X, Pause, Play, RotateCw, Folder, File as FileIcon, ChevronUp, AlertTriangle } from "lucide-react";
import { useTransfersStore } from "../state/transfers";
import { buildStripModel, stripHasContent, type StripModel, type GestureItem } from "../state/transferView";
import { useT } from "../i18n";

// Route pause / resume / cancel through the store (not the raw IPC
// wrappers) so the optimistic UI flip fires before Rust confirms.
const store = () => useTransfersStore.getState();

interface Scope {
  connectionId?: string;
  showAll?: boolean;
}

/** True while the strip has anything to show — used by the shells to
 *  decide whether to render the surrounding chrome at all. Failures
 *  count: they wait for a retry or a dismissal, and hiding them would
 *  be pretending they did not happen. */
export function useHasVisibleTransfers(connectionId?: string, showAll?: boolean): boolean {
  return useTransfersStore((s) =>
    stripHasContent(buildStripModel(s.list, { connectionId, showAll })),
  );
}

/** True when there are at least two gestures — the only case where the
 *  bar can expand into rows. One gesture IS the bar. */
export function useCanExpandTransfers(connectionId?: string, showAll?: boolean): boolean {
  return useTransfersStore((s) =>
    buildStripModel(s.list, { connectionId, showAll }).canExpand,
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Compact, language-neutral remaining time: "40s", "5m 20s", "1h 12m". */
function formatEta(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}

function useStripModel({ connectionId, showAll }: Scope): StripModel {
  // Select the raw list and derive with useMemo: a selector that builds
  // a fresh object every call never compares equal, and zustand would
  // re-render forever.
  const list = useTransfersStore((s) => s.list);
  return useMemo(
    () => buildStripModel(list, { connectionId, showAll }),
    [list, connectionId, showAll],
  );
}

/**
 * The one-line bar. With a single gesture it IS that gesture — name,
 * numbers, pause / cancel — and there is nothing to expand. With
 * several, it shows the oldest name plus "and N more" over the combined
 * totals, and the whole bar becomes the expand / collapse click target.
 */
export function TransferBar({ connectionId, showAll, expanded, onToggle }: Scope & {
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const m = useStripModel({ connectionId, showAll });
  if (!stripHasContent(m)) return null;

  const hasFailure = m.failedCount > 0;
  const name = m.itemCount > 1
    ? `${m.primaryLabel} ${t("and")} ${m.itemCount - 1} ${t("more items")}`
    : m.primaryLabel;
  const detail = [
    m.totalFiles > 1 ? `${m.doneFiles}/${m.totalFiles} ${t("files")}` : null,
    m.totalBytes > 0 ? `${formatSize(m.bytesDone)} / ${formatSize(m.totalBytes)}` : null,
    // Speed and remaining time whenever bytes are moving — what a
    // transfer bar is for.
    m.anyActive && m.rateBps > 0 ? `${formatSize(m.rateBps)}/s` : null,
    m.anyActive && m.rateBps > 0 && m.totalBytes > m.bytesDone
      ? formatEta((m.totalBytes - m.bytesDone) / m.rateBps)
      : null,
    m.totalBytes > 0 ? `${Math.round(m.pct)}%` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      role="button"
      aria-label="transfers"
      aria-expanded={m.canExpand ? expanded : undefined}
      onClick={m.canExpand ? onToggle : undefined}
      style={{
        height: 28, display: "flex", alignItems: "center", gap: 8,
        padding: "0 10px", position: "relative", overflow: "hidden",
        cursor: m.canExpand ? "pointer" : "default", flexShrink: 0,
        background: "var(--panel-1)", userSelect: "none",
      }}>
      <div aria-hidden="true" style={{
        position: "absolute", left: 0, top: 0, bottom: 0,
        width: `${m.pct}%`,
        background: hasFailure ? "var(--error-fade)" : "var(--accent-fade)",
        transition: "width 200ms linear",
      }} />
      <span style={{
        position: "relative", fontSize: 12, fontWeight: 600,
        color: hasFailure ? "var(--error)" : "var(--text-1)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        maxWidth: 300,
      }}>
        {name}
        {hasFailure && ` · ${m.failedCount} ${t("items failed")}`}
      </span>
      {m.direction && (
        <span style={{ position: "relative", fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
          {m.direction === "upload" ? t("to remote") : t("to local")}
        </span>
      )}
      <span style={{ position: "relative", fontSize: 11, color: "var(--text-2)", flexShrink: 0 }}>
        {detail}
      </span>
      <span style={{ position: "relative", flex: 1 }} />
      {/* Bulk buttons are single IPC calls: pausing per id meant one
          call per file, and a 20 000-file queue outran the clicks —
          slots kept starting new files while the calls landed. */}
      {m.anyActive && (
        <IconButton label={t("Pause all")} onClick={() => void store().pauseAll(connectionId)}>
          <Pause size={12} />
        </IconButton>
      )}
      {!m.anyActive && m.anyPaused && (
        <IconButton label={t("Resume all")} onClick={() => void store().resumeAll(connectionId)}>
          <Play size={12} />
        </IconButton>
      )}
      <IconButton label={t("Cancel all")} onClick={() => void store().cancelAll(connectionId)}>
        <X size={12} />
      </IconButton>
      {m.canExpand && (
        <span aria-hidden="true" style={{
          position: "relative", color: "var(--text-3)", flexShrink: 0,
          display: "inline-flex", transition: "transform 150ms",
          transform: expanded ? "rotate(180deg)" : "none",
        }}>
          <ChevronUp size={12} />
        </span>
      )}
    </div>
  );
}

/**
 * The expanded panel: one flat row per gesture, in arrival order. A row
 * carries only the gesture's own totals — never which file inside it is
 * moving, never a per-file failure list. A fully-failed gesture turns
 * red in place with the dominant error and a Retry-all.
 */
export function TransferRows({ connectionId, showAll }: Scope) {
  const m = useStripModel({ connectionId, showAll });

  return (
    <div role="list" style={{
      height: "100%", overflowY: "auto", padding: "4px 6px 6px",
      background: "var(--panel-1)", borderTop: "1px solid var(--border)",
    }}>
      {m.gestures.map((g) => <GestureRow key={g.key} g={g} />)}
    </div>
  );
}

function GestureRow({ g }: { g: GestureItem }) {
  const t = useT();
  const failedOnly = g.status === "failed";

  const stat = failedOnly
    ? [
        g.isGroup ? `${g.failedCount} ${t("files failed")}` : null,
        g.mainError,
      ].filter(Boolean).join(" · ")
    : [
        g.totalFiles > 1 ? `${g.doneFiles}/${g.totalFiles} ${t("files")}` : null,
        g.totalBytes > 0
          ? `${formatSize(g.bytesDone)} / ${formatSize(g.totalBytes)} · ${Math.round(g.pct)}%`
          : formatSize(g.bytesDone),
        g.status === "active" && g.rateBps > 0 ? `${formatSize(g.rateBps)}/s` : null,
        g.status === "active" && g.rateBps > 0 && g.totalBytes > g.bytesDone
          ? formatEta((g.totalBytes - g.bytesDone) / g.rateBps)
          : null,
        g.status === "paused" ? t("paused") : null,
        g.status === "queued" ? t("Waiting") : null,
      ].filter(Boolean).join(" · ");

  // Per-row operations route by shape: a group hits the one-call bulk
  // commands, a lone file the per-id ones.
  const pause = () => void (g.groupId ? store().pauseGroup(g.groupId) : store().pause(g.soloId!));
  const resume = () => void (g.groupId ? store().resumeGroup(g.groupId) : store().resume(g.soloId!));
  const cancel = () => void (g.groupId ? store().cancelGroup(g.groupId) : store().cancel(g.soloId!));
  const retry = () => void (g.groupId ? store().retryGroup(g.groupId) : store().retry(g.soloId!));
  const dismiss = () => g.groupId ? store().removeGroup(g.groupId) : store().remove(g.soloId!);

  return (
    <Row pct={failedOnly ? 100 : g.pct} tone={failedOnly ? "error" : g.status === "paused" ? "paused" : "normal"}>
      <span style={{
        flexShrink: 0, display: "inline-flex",
        color: failedOnly ? "var(--error)" : "var(--text-2)",
      }}>
        {failedOnly ? <AlertTriangle size={11} /> : g.isGroup ? <Folder size={11} /> : <FileIcon size={11} />}
      </span>
      <span style={{
        flex: 1, minWidth: 0, fontWeight: 500,
        color: failedOnly ? "var(--error)" : "var(--text-1)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{g.label}</span>
      <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
        {g.direction === "upload" ? t("to remote") : t("to local")}
      </span>
      <span style={{
        fontSize: 10, flexShrink: 0,
        color: failedOnly ? "var(--error)" : "var(--text-2)",
        maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {stat}
        {/* A gesture still moving with some children already failed:
            the count rides along in red, the decision waits for the end. */}
        {!failedOnly && g.failedCount > 0 && (
          <span style={{ color: "var(--error)" }}>{` · ${g.failedCount} ${t("items failed")}`}</span>
        )}
      </span>
      {failedOnly ? (
        <>
          <RowButton label={t("Retry")} onClick={retry}>
            <RotateCw size={11} />
          </RowButton>
          <RowButton label={t("Dismiss")} onClick={dismiss}>
            <X size={11} />
          </RowButton>
        </>
      ) : (
        <>
          {g.status === "paused" ? (
            <RowButton label={t("Resume")} onClick={resume}>
              <Play size={11} />
            </RowButton>
          ) : (
            <RowButton label={t("Pause")} onClick={pause}>
              <Pause size={11} />
            </RowButton>
          )}
          <RowButton label={t("Cancel")} onClick={cancel}>
            <X size={11} />
          </RowButton>
        </>
      )}
    </Row>
  );
}

function Row({ pct, tone, children }: {
  pct: number;
  tone: "normal" | "paused" | "error";
  children: React.ReactNode;
}) {
  const fill = tone === "error"
    ? "var(--error-fade)"
    : tone === "paused"
      ? "rgba(242, 200, 162, 0.22)"
      : "var(--accent-fade)";
  return (
    <div role="listitem" style={{
      position: "relative", overflow: "hidden", borderRadius: 4,
      display: "flex", alignItems: "center", gap: 7, padding: "0 8px",
      height: 24, fontSize: 11.5, marginBottom: 2,
      background: "var(--panel-2)",
    }}>
      {pct > 0 && (
        <div aria-hidden="true" style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: `${Math.min(100, pct)}%`, background: fill,
          transition: "width 200ms linear",
        }} />
      )}
      <div style={{
        position: "relative", display: "flex", alignItems: "center",
        gap: 7, flex: 1, minWidth: 0,
      }}>{children}</div>
    </div>
  );
}

function IconButton({ label, onClick, children }: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position: "relative", background: "transparent", border: "none",
        color: "var(--text-3)", cursor: "pointer", padding: "2px 3px",
        display: "inline-flex", flexShrink: 0,
      }}>
      {children}
    </button>
  );
}

function RowButton(props: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <IconButton {...props} />;
}

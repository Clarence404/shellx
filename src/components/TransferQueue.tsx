import { useMemo } from "react";
import { X, Pause, Play, RotateCw, Folder, File as FileIcon, ChevronUp } from "lucide-react";
import { useTransfersStore } from "../state/transfers";
import { buildStripModel, stripHasContent, type StripModel } from "../state/transferView";
import { useT } from "../i18n";
import type { TransferInfo } from "../types/sftp";

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
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
 * The one-line bar: name of what is moving, the numbers, pause-all /
 * cancel-all, and a chevron that is an indicator, not a button — the
 * whole bar is the click target for expand / collapse.
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
    m.totalBytes > 0 ? `${Math.round(m.pct)}%` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      role="button"
      aria-label="transfers"
      aria-expanded={expanded}
      onClick={onToggle}
      style={{
        height: 28, display: "flex", alignItems: "center", gap: 8,
        padding: "0 10px", position: "relative", overflow: "hidden",
        cursor: "pointer", flexShrink: 0, background: "var(--panel-1)",
        userSelect: "none",
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
      {m.anyActive && (
        <IconButton label={t("Pause all")} onClick={() => {
          for (const x of m.transferring) if (x.state.kind === "active") void store().pause(x.id);
        }}>
          <Pause size={12} />
        </IconButton>
      )}
      {!m.anyActive && m.anyPaused && (
        <IconButton label={t("Resume all")} onClick={() => {
          for (const x of m.transferring) if (x.state.kind === "paused") void store().resume(x.id);
        }}>
          <Play size={12} />
        </IconButton>
      )}
      <IconButton label={t("Cancel all")} onClick={() => {
        const groups = new Set<string>();
        for (const x of m.transferring) {
          if (x.groupId) groups.add(x.groupId);
        }
        for (const w of m.waiting) {
          if (w.groupId) groups.add(w.groupId);
          else for (const id of w.ids) void store().cancel(id);
        }
        for (const g of groups) void store().cancelGroup(g);
        for (const x of m.transferring) if (!x.groupId) void store().cancel(x.id);
      }}>
        <X size={12} />
      </IconButton>
      <span aria-hidden="true" style={{
        position: "relative", color: "var(--text-3)", flexShrink: 0,
        display: "inline-flex", transition: "transform 150ms",
        transform: expanded ? "rotate(180deg)" : "none",
      }}>
        <ChevronUp size={12} />
      </span>
    </div>
  );
}

/**
 * The expanded panel: three flat sections. Failed first (it needs a
 * decision), then the files actually moving (at most the concurrency
 * cap), then what waits — one line per dragged item, so the list stays
 * a screenful however many files a directory brought.
 */
export function TransferRows({ connectionId, showAll }: Scope) {
  const t = useT();
  const m = useStripModel({ connectionId, showAll });

  return (
    <div role="list" style={{
      height: "100%", overflowY: "auto", padding: "0 6px 6px",
      background: "var(--panel-1)", borderTop: "1px solid var(--border)",
    }}>
      {m.failed.length > 0 && (
        <>
          <SectionLabel text={`${t("Failed")} · ${m.failed.length}`} tone="error" />
          {m.failed.map((x) => (
            <Row key={x.id} pct={pctOf(x)} tone="error">
              <RowName t={x} />
              <span style={{ fontSize: 10, color: "var(--error)", flexShrink: 0 }}>
                {x.state.kind === "failed" ? x.state.error : ""}
              </span>
              <RowButton label={t("Retry")} onClick={() => void store().retry(x.id)}>
                <RotateCw size={11} />
              </RowButton>
              <RowButton label={t("Dismiss")} onClick={() => void store().remove(x.id)}>
                <X size={11} />
              </RowButton>
            </Row>
          ))}
        </>
      )}

      {m.transferring.length > 0 && (
        <>
          <SectionLabel text={t("Transferring")} />
          {m.transferring.map((x) => (
            <Row key={x.id} pct={pctOf(x)} tone={x.state.kind === "paused" ? "paused" : "normal"}>
              <RowName t={x} showDest={m.direction === null} />
              <span style={{ fontSize: 10, color: "var(--text-2)", flexShrink: 0 }}>
                {x.total_bytes > 0
                  ? `${formatSize(x.bytes_done)} / ${formatSize(x.total_bytes)} · ${Math.round(pctOf(x))}%`
                  : formatSize(x.bytes_done)}
                {x.state.kind === "paused" ? ` · ${t("paused")}` : ""}
              </span>
              {x.state.kind === "paused" ? (
                <RowButton label={t("Resume")} onClick={() => void store().resume(x.id)}>
                  <Play size={11} />
                </RowButton>
              ) : (
                <RowButton label={t("Pause")} onClick={() => void store().pause(x.id)}>
                  <Pause size={11} />
                </RowButton>
              )}
              <RowButton label={t("Cancel")} onClick={() => void store().cancel(x.id)}>
                <X size={11} />
              </RowButton>
            </Row>
          ))}
        </>
      )}

      {m.waiting.length > 0 && (
        <>
          <SectionLabel text={t("Waiting")} />
          {m.waiting.map((w) => (
            <Row key={w.key} pct={0} tone="item">
              <span style={{ flexShrink: 0, color: "var(--text-2)", display: "inline-flex" }}>
                {w.isDir ? <Folder size={11} /> : <FileIcon size={11} />}
              </span>
              <span style={{
                flex: 1, minWidth: 0, fontWeight: 500,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{w.label}</span>
              <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
                {w.direction === "upload" ? t("to remote") : t("to local")}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-2)", flexShrink: 0 }}>
                {w.isDir ? `${w.remainingFiles} ${t("files left")}` : ""}
                {w.remainingBytes > 0 ? ` · ${formatSize(w.remainingBytes)}` : ""}
              </span>
              <RowButton
                label={t("Cancel")}
                onClick={() => {
                  if (w.groupId) void store().cancelGroup(w.groupId);
                  else for (const id of w.ids) void store().cancel(id);
                }}>
                <X size={11} />
              </RowButton>
            </Row>
          ))}
        </>
      )}
    </div>
  );
}

function pctOf(t: TransferInfo): number {
  return t.total_bytes > 0 ? Math.min(100, (t.bytes_done / t.total_bytes) * 100) : 0;
}

/** Name cell: dim relative-directory prefix, then the file name. */
function RowName({ t, showDest }: { t: TransferInfo; showDest?: boolean }) {
  const tr = useT();
  const parts = t.remote_path.split(/[\\/]/).filter(Boolean);
  const name = parts.pop() ?? t.remote_path;
  const prefix = parts.length > 1 ? `${parts[parts.length - 1]}/` : "";
  return (
    <>
      <span style={{
        flex: 1, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {prefix && <span style={{ color: "var(--text-3)" }}>{prefix}</span>}
        {name}
      </span>
      {showDest && (
        <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>
          {t.direction === "upload" ? tr("to remote") : tr("to local")}
        </span>
      )}
    </>
  );
}

function SectionLabel({ text, tone }: { text: string; tone?: "error" }) {
  return (
    <div style={{
      fontSize: 10, letterSpacing: 0.4, padding: "5px 3px 3px",
      color: tone === "error" ? "var(--error)" : "var(--text-3)",
    }}>{text}</div>
  );
}

function Row({ pct, tone, children }: {
  pct: number;
  tone: "normal" | "paused" | "error" | "item";
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
      height: 23, fontSize: 11.5, marginBottom: 2,
      background: tone === "item" ? "var(--panel-2)" : "transparent",
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

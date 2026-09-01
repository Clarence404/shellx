import type { TransferInfo } from "../types/sftp";

/**
 * Turns the raw transfer list into what the strip shows. The unit is a
 * GESTURE — one drag / one dialog pick — never a file: a directory of
 * twenty thousand files is one row, a multi-select of loose files is
 * one row, a lone file is one row. What happens inside a gesture (which
 * file is moving, which children failed) is never listed; only the
 * gesture's own totals are. That keeps the expanded panel at "number of
 * times the user dragged" rows, which a human hand cannot make long.
 */

export type GestureStatus = "active" | "paused" | "queued" | "failed";

export interface GestureItem {
  /** groupId for a batch, the transfer's own id for a lone file. */
  key: string;
  groupId?: string;
  /** Set for a lone file — per-id IPC ops apply. */
  soloId?: string;
  label: string;
  isGroup: boolean;
  direction: "upload" | "download";
  bytesDone: number;
  totalBytes: number;
  /** 0..100 over the gesture's own bytes. */
  pct: number;
  doneFiles: number;
  totalFiles: number;
  failedCount: number;
  /** The most common failure message, for the red row's one-liner. */
  mainError: string | null;
  /** Sum of the active members' last reported rates, bytes/sec. */
  rateBps: number;
  status: GestureStatus;
}

export interface StripModel {
  /** One row per unfinished (or failed-awaiting-decision) gesture. */
  gestures: GestureItem[];
  /** The oldest gesture's name — what the bar leads with. */
  primaryLabel: string;
  itemCount: number;
  /** The expanded panel exists only when there is something to expand:
   *  a single gesture IS the bar, so the chevron disappears. */
  canExpand: boolean;
  /** "upload" | "download" when every unfinished transfer agrees. */
  direction: "upload" | "download" | null;
  bytesDone: number;
  totalBytes: number;
  pct: number;
  doneFiles: number;
  totalFiles: number;
  failedCount: number;
  /** Combined speed across every moving transfer, bytes/sec. */
  rateBps: number;
  anyActive: boolean;
  anyPaused: boolean;
}

function baseName(t: TransferInfo): string {
  return t.remote_path.split(/[\\/]/).pop() || t.remote_path;
}

/** The name a gesture goes by: the label recorded at spawn, with a
 *  path-derived fallback for rows written before the label existed. */
function gestureLabel(t: TransferInfo): string {
  if (t.groupLabel) return t.groupLabel;
  if (!t.groupId) return baseName(t);
  const parts = (t.direction === "upload" ? t.remote_path : t.local_path)
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : parts[parts.length - 1] ?? "…";
}

const IN_FLIGHT = new Set(["queued", "active", "paused"]);

export function buildStripModel(
  list: TransferInfo[],
  scope: { connectionId?: string; showAll?: boolean },
): StripModel {
  const scoped = scope.showAll
    ? list
    : list.filter((t) => t.connection_id === scope.connectionId);

  // Bucket by gesture, preserving arrival order. Done members stay in
  // their bucket so the gesture's totals count up rather than the
  // denominator shrinking as files finish.
  const keys: string[] = [];
  const members = new Map<string, TransferInfo[]>();
  for (const t of scoped) {
    const k = t.groupId ?? t.id;
    const bucket = members.get(k);
    if (bucket) bucket.push(t);
    else {
      keys.push(k);
      members.set(k, [t]);
    }
  }

  const gestures: GestureItem[] = [];
  let anyActive = false;
  let anyPaused = false;
  let bytesDone = 0;
  let totalBytes = 0;
  let doneFiles = 0;
  let totalFiles = 0;
  let failedFiles = 0;
  const directions = new Set<"upload" | "download">();

  for (const key of keys) {
    const ms = members.get(key)!;
    const inFlight = ms.filter((t) => IN_FLIGHT.has(t.state.kind));
    const failed = ms.filter((t) => t.state.kind === "failed");
    const done = ms.filter((t) => t.state.kind === "done");

    // A gesture that is fully done (or fully cancelled) has left the
    // strip; its lingering members do not join the bar's totals either,
    // or a finished 20 GB drag would pin the percentage forever.
    if (inFlight.length === 0 && failed.length === 0) continue;

    const counted = [...inFlight, ...failed, ...done];
    const gBytesDone = counted.reduce((n, t) => n + t.bytes_done, 0);
    const gTotalBytes = counted.reduce((n, t) => n + t.total_bytes, 0);
    const first = ms[0];

    let status: GestureStatus;
    if (inFlight.some((t) => t.state.kind === "active")) status = "active";
    else if (inFlight.some((t) => t.state.kind === "paused")) status = "paused";
    else if (inFlight.length > 0) status = "queued";
    else status = "failed";

    // The dominant failure message: almost always they all failed the
    // same way, and one line answers "why" without a per-file list.
    let mainError: string | null = null;
    if (failed.length > 0) {
      const counts = new Map<string, number>();
      for (const f of failed) {
        const msg = f.state.kind === "failed" ? f.state.error : "";
        counts.set(msg, (counts.get(msg) ?? 0) + 1);
      }
      mainError = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] || null;
    }

    gestures.push({
      key,
      groupId: first.groupId,
      soloId: first.groupId ? undefined : first.id,
      label: gestureLabel(first),
      isGroup: !!first.groupId,
      direction: first.direction,
      bytesDone: gBytesDone,
      totalBytes: gTotalBytes,
      pct: gTotalBytes > 0 ? Math.min(100, (gBytesDone / gTotalBytes) * 100) : 0,
      doneFiles: done.length,
      totalFiles: counted.length,
      failedCount: failed.length,
      mainError,
      rateBps: inFlight.reduce((n, t) => n + (t.rateBps ?? 0), 0),
      status,
    });

    anyActive ||= inFlight.some((t) => t.state.kind === "active" || t.state.kind === "queued");
    anyPaused ||= inFlight.some((t) => t.state.kind === "paused");
    bytesDone += gBytesDone;
    totalBytes += gTotalBytes;
    doneFiles += done.length;
    totalFiles += counted.length;
    failedFiles += failed.length;
    for (const t of inFlight) directions.add(t.direction);
  }

  return {
    gestures,
    primaryLabel: gestures[0]?.label ?? "",
    itemCount: gestures.length,
    canExpand: gestures.length >= 2,
    direction: directions.size === 1 ? [...directions][0] : null,
    bytesDone,
    totalBytes,
    pct: totalBytes > 0 ? Math.min(100, (bytesDone / totalBytes) * 100) : 0,
    doneFiles,
    totalFiles,
    failedCount: failedFiles,
    rateBps: gestures.reduce((n, g) => n + g.rateBps, 0),
    anyActive,
    anyPaused,
  };
}

/** The strip renders at all only while there is something to show:
 *  anything in flight, or a failure awaiting a retry / dismissal. */
export function stripHasContent(model: StripModel): boolean {
  return model.gestures.length > 0;
}

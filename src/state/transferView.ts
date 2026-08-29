import type { TransferInfo } from "../types/sftp";

/**
 * Turns the raw transfer list into what the strip shows: one bar line,
 * and three flat sections — failed, transferring, waiting. No nesting:
 * what is moving is listed by file (there are at most a handful, the
 * concurrency cap sees to that), what is waiting is summarised by item
 * (one drag gesture = one line), so the list stays a screenful no
 * matter how many files a directory brought along.
 */

export interface WaitingItem {
  /** groupId for a directory, the transfer's own id for a lone file. */
  key: string;
  label: string;
  isDir: boolean;
  direction: "upload" | "download";
  remainingFiles: number;
  /** Sum of known sizes; 0 when the server has not said yet. */
  remainingBytes: number;
  /** What a ✕ on this line cancels. */
  ids: string[];
  groupId?: string;
}

export interface StripModel {
  /** The oldest unfinished item's name — what the bar leads with. */
  primaryLabel: string;
  /** Unfinished items (gestures), for the "and N more" suffix. */
  itemCount: number;
  /** "upload" | "download" when every unfinished transfer agrees. */
  direction: "upload" | "download" | null;
  bytesDone: number;
  totalBytes: number;
  /** 0..100, guarded against a zero total. */
  pct: number;
  doneFiles: number;
  totalFiles: number;
  failedCount: number;
  /** Anything can be paused. */
  anyActive: boolean;
  anyPaused: boolean;
  failed: TransferInfo[];
  transferring: TransferInfo[];
  waiting: WaitingItem[];
}

function baseName(t: TransferInfo): string {
  return t.remote_path.split(/[\\/]/).pop() || t.remote_path;
}

/** The folder a group was spawned for: the first path segment of the
 *  child's position under the destination root. */
function groupLabel(t: TransferInfo): string {
  // Recorded at spawn on every child; deriving from a child's path
  // drifted — a file inside dir/caches/ made the bar say "caches"
  // instead of the folder the user actually dragged. The path fallback
  // only covers rows written before the label existed.
  if (t.groupLabel) return t.groupLabel;
  const parts = (t.direction === "upload" ? t.remote_path : t.local_path)
    .split(/[\\/]/)
    .filter(Boolean);
  // …/<dir>/<child…>: the dir is the segment above the file, but for a
  // nested child it is further up. Without the walk's root we take the
  // segment right above the top-most child — good enough for a label.
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

  const failed = scoped.filter((t) => t.state.kind === "failed");
  const inFlight = scoped.filter((t) => IN_FLIGHT.has(t.state.kind));
  const done = scoped.filter((t) => t.state.kind === "done");

  // Items, in arrival order. A group is one item however many children
  // it has; a solo transfer is its own item.
  const itemKeys: string[] = [];
  const itemOf = (t: TransferInfo) => t.groupId ?? t.id;
  for (const t of [...inFlight, ...failed]) {
    const k = itemOf(t);
    if (!itemKeys.includes(k)) itemKeys.push(k);
  }

  // Actively moving (or paused mid-move): shown per file. `queued` with
  // bytes already moved counts too — a resumed transfer briefly reports
  // queued while it waits for its slot back.
  const transferring = inFlight.filter(
    (t) => t.state.kind === "active" || t.state.kind === "paused" || t.bytes_done > 0,
  );
  const transferringIds = new Set(transferring.map((t) => t.id));
  const queued = inFlight.filter((t) => !transferringIds.has(t.id));

  // Waiting, one line per item.
  const waiting: WaitingItem[] = [];
  for (const key of itemKeys) {
    const members = queued.filter((t) => itemOf(t) === key);
    if (members.length === 0) continue;
    const first = members[0];
    const isDir = !!first.groupId;
    waiting.push({
      key,
      label: isDir ? groupLabel(first) : baseName(first),
      isDir,
      direction: first.direction,
      remainingFiles: members.length,
      remainingBytes: members.reduce((n, t) => n + t.total_bytes, 0),
      ids: members.map((t) => t.id),
      groupId: first.groupId,
    });
  }

  // Bar aggregates cover everything unfinished plus what already
  // finished this session, so "9/28 files" counts up rather than the
  // denominator shrinking as files complete.
  const counted = [...inFlight, ...failed, ...done];
  const bytesDone = counted.reduce((n, t) => n + t.bytes_done, 0);
  const totalBytes = counted.reduce((n, t) => n + t.total_bytes, 0);
  const directions = new Set(inFlight.map((t) => t.direction));

  const primary = inFlight[0] ?? failed[0];
  const primaryLabel = primary
    ? (primary.groupId ? groupLabel(primary) : baseName(primary))
    : "";

  return {
    primaryLabel,
    itemCount: itemKeys.length,
    direction: directions.size === 1 ? [...directions][0] : null,
    bytesDone,
    totalBytes,
    pct: totalBytes > 0 ? Math.min(100, (bytesDone / totalBytes) * 100) : 0,
    doneFiles: done.length,
    totalFiles: counted.length,
    failedCount: failed.length,
    anyActive: inFlight.some((t) => t.state.kind === "active" || t.state.kind === "queued"),
    anyPaused: inFlight.some((t) => t.state.kind === "paused"),
    failed,
    transferring,
    waiting,
  };
}

/** The strip renders at all only while there is something to show:
 *  anything in flight, or a failure awaiting dismissal. */
export function stripHasContent(model: StripModel): boolean {
  return model.transferring.length > 0 || model.waiting.length > 0 || model.failed.length > 0;
}

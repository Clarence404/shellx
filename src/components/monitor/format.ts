import type { MonitorSnapshot } from "../../types/monitor";

/** Health bands shared by CPU/memory tiles and the disk fullness bars. */
export type Health = "ok" | "warn" | "bad";
export function healthOf(pct: number): Health {
  if (pct >= 90) return "bad";
  if (pct >= 70) return "warn";
  return "ok";
}
export const healthColor: Record<Health, string> = {
  ok: "var(--success)",
  warn: "var(--warn)",
  bad: "var(--error)",
};
export const healthFade: Record<Health, string> = {
  ok: "var(--success-fade)",
  warn: "var(--warn-fade)",
  bad: "var(--error-fade)",
};

/** Per-second byte rate, e.g. "1.2 MB/s". */
export function fmtRate(bps: number): string {
  if (bps >= 1_073_741_824) return `${(bps / 1_073_741_824).toFixed(1)} GB/s`;
  if (bps >= 1_048_576) return `${(bps / 1_048_576).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

/** A byte count, e.g. "142 GB". */
export function fmtBytes(b: number): string {
  if (b >= 1_099_511_627_776) return `${(b / 1_099_511_627_776).toFixed(1)} TB`;
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${Math.round(b)} B`;
}

/** A KB count (meminfo unit), e.g. "3.2 GB". */
export function fmtKb(kb: number): string {
  return fmtBytes(kb * 1024);
}

/** "2d 3h 7m" from seconds. */
export function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Aggregate rx+tx (or read+write) across the latest snapshot. */
export function netRate(s: MonitorSnapshot | undefined): { rx: number; tx: number } {
  if (!s) return { rx: 0, tx: 0 };
  return s.network.reduce(
    (acc, n) => ({ rx: acc.rx + n.rxBytesPerSec, tx: acc.tx + n.txBytesPerSec }),
    { rx: 0, tx: 0 },
  );
}

/** Pull one numeric series out of the snapshot history for a sparkline/chart. */
export function series(snaps: MonitorSnapshot[], pick: (s: MonitorSnapshot) => number): number[] {
  return snaps.map(pick);
}

/** "115200 · 8N1"-style short line, but for load: color by 1-min vs cores. */
export function loadHealth(load1: number, cores: number): Health {
  const ratio = cores > 0 ? load1 / cores : load1;
  if (ratio >= 1) return "bad";
  if (ratio >= 0.7) return "warn";
  return "ok";
}

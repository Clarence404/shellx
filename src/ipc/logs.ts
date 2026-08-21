import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  ts: string; // ISO-8601 UTC
  level: LogLevel;
  category: string;
  message: string;
  fields: Record<string, unknown>;
}

export interface LogsStats {
  total: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
}

export interface LogFilter {
  query?: string;
  min_level?: LogLevel;
  categories?: string[];
}

export interface LogsSnapshotResult {
  entries: LogEntry[];
  stats: LogsStats;
}

export async function logsSnapshot(filter?: LogFilter, limit?: number, after_id?: number): Promise<LogsSnapshotResult> {
  return invoke("logs_snapshot", { filter, limit, afterId: after_id });
}

export async function logsSubscribe(): Promise<void> {
  return invoke("logs_subscribe");
}

export async function logsUnsubscribe(): Promise<void> {
  return invoke("logs_unsubscribe");
}

export async function logsExport(path: string, filter?: LogFilter): Promise<number> {
  return invoke("logs_export", { path, filter });
}

export async function logsSetDiskEnabled(enabled: boolean): Promise<void> {
  return invoke("logs_set_disk_enabled", { enabled });
}

export async function logsDiskEnabled(): Promise<boolean> {
  return invoke("logs_disk_enabled");
}

/** Push a frontend-side event into the shared log stream.
 *
 *  Never rejects: callers fire these off with `void logPush(...)` from
 *  inside unrelated flows, and a logging round-trip that failed (bridge
 *  not up yet, backend gone) must not surface as an unhandled rejection
 *  in the middle of a transfer or a reconnect. */
export async function logPush(args: {
  level: LogLevel;
  category: string;
  message: string;
  fields?: Record<string, unknown>;
}): Promise<void> {
  try {
    await invoke("logs_push", { args: { ...args, fields: args.fields ?? {} } });
  } catch {
    /* logging must never break the caller */
  }
}

export function onLogEntry(cb: (entry: LogEntry) => void): Promise<UnlistenFn> {
  return listen<LogEntry>("logs:entry", (ev) => cb(ev.payload));
}

export function onLogLagged(cb: () => void): Promise<UnlistenFn> {
  return listen("logs:lagged", () => cb());
}

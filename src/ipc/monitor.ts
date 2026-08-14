import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MonitorSnapshot } from "../types/monitor";

export async function startMonitor(connId: string): Promise<void> {
  await invoke("monitor_start", { connId });
}

export async function stopMonitor(connId: string): Promise<void> {
  await invoke("monitor_stop", { connId });
}

export function onMonitorSnapshot(
  connId: string,
  cb: (snap: MonitorSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<MonitorSnapshot>("monitor:snapshot", (ev) => {
    if (ev.payload.connectionId === connId) cb(ev.payload);
  });
}

export function onMonitorUnsupported(
  connId: string,
  cb: (connId: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("monitor:unsupported", (ev) => {
    if (ev.payload === connId) cb(ev.payload);
  });
}

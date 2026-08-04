import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnectionId } from "../types/connection";

export interface DataEvent {
  id: ConnectionId;
  data: number[];
}

export interface ClosedEvent {
  id: ConnectionId;
  reason: string;
}

export const onSessionData = (handler: (e: DataEvent) => void): Promise<UnlistenFn> =>
  listen<DataEvent>("session:data", (ev) => handler(ev.payload));

export const onConnectionClosed = (h: (e: ClosedEvent) => void): Promise<UnlistenFn> =>
  listen<ClosedEvent>("connection:closed", (ev) => h(ev.payload));

// keep onSessionClosed as an alias listening to the new event name
export const onSessionClosed = onConnectionClosed;

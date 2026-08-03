import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SessionId } from "../types/session";

export interface DataEvent {
  id: SessionId;
  data: number[];
}

export interface ClosedEvent {
  id: SessionId;
  reason: string;
}

export const onSessionData = (handler: (e: DataEvent) => void): Promise<UnlistenFn> =>
  listen<DataEvent>("session:data", (ev) => handler(ev.payload));

export const onSessionClosed = (handler: (e: ClosedEvent) => void): Promise<UnlistenFn> =>
  listen<ClosedEvent>("session:closed", (ev) => handler(ev.payload));

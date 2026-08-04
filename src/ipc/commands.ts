import { invoke } from "@tauri-apps/api/core";
import type { ConnectionId, ConnectionInfo, OpenConnectionArgs } from "../types/connection";

export const openConnection = (args: OpenConnectionArgs): Promise<ConnectionInfo> =>
  invoke<ConnectionInfo>("open_connection", { args });

export const writeSessionInput = (id: ConnectionId, data: number[]): Promise<void> =>
  invoke<void>("write_session_input", { args: { id, data } });

export const resizeSession = (id: ConnectionId, cols: number, rows: number): Promise<void> =>
  invoke<void>("resize_session", { args: { id, cols, rows } });

export const closeConnection = (id: ConnectionId): Promise<void> =>
  invoke<void>("close_connection", { args: { id } });

// Alias kept for one release cycle so existing callsites keep working.
export const closeSession = closeConnection;

export const listSessions = (): Promise<ConnectionInfo[]> =>
  invoke<ConnectionInfo[]>("list_sessions");

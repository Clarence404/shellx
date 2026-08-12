import { invoke } from "@tauri-apps/api/core";
import type { ConnectionId, ConnectionInfo, OpenConnectionArgs } from "../types/connection";

export const openConnection = (args: OpenConnectionArgs): Promise<ConnectionInfo> =>
  invoke<ConnectionInfo>("open_connection", { args });

/** Opens the shell channel on an already-established connection.
 *  Idempotent on the backend — a session that already has a shell is a
 *  no-op. Used when a host switches from tunnels-only to a terminal mode
 *  so its live sessions gain a shell without reconnecting. */
export const openShell = (id: ConnectionId): Promise<void> =>
  invoke<void>("open_shell", { args: { id } });

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

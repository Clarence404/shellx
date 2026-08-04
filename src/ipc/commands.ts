import { invoke } from "@tauri-apps/api/core";
import type { OpenSshArgs, SessionId, SessionInfo } from "../types/session";

export const openConnection = (args: OpenSshArgs): Promise<SessionInfo> =>
  invoke<SessionInfo>("open_connection", { args });

export const writeSessionInput = (id: SessionId, data: number[]): Promise<void> =>
  invoke<void>("write_session_input", { args: { id, data } });

export const resizeSession = (id: SessionId, cols: number, rows: number): Promise<void> =>
  invoke<void>("resize_session", { args: { id, cols, rows } });

export const closeSession = (id: SessionId): Promise<void> =>
  invoke<void>("close_connection", { args: { id } });

export const listSessions = (): Promise<SessionInfo[]> =>
  invoke<SessionInfo[]>("list_sessions");

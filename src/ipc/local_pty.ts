import { invoke } from "@tauri-apps/api/core";
import type { ConnectionInfo } from "../types/connection";

export const openLocalTerminal = (): Promise<ConnectionInfo> =>
  invoke<ConnectionInfo>("open_local_terminal");

export const closeLocalTerminal = (id: string): Promise<void> =>
  invoke<void>("close_local_terminal", { args: { id } });

import { invoke } from "@tauri-apps/api/core";
import type { SshConfigScan } from "../types/sshconfig";

/** Reads `~/.ssh/config` (the frontend has no filesystem access of its own). */
export const scanSshConfig = (path?: string) =>
  invoke<SshConfigScan>("ssh_config_scan", { path: path ?? null });

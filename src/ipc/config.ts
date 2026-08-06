import { invoke } from "@tauri-apps/api/core";

export interface ConfigPaths {
  /** Absolute path to the config directory (contains hosts.db + settings.json). */
  configDir: string;
  hostsDb: string;
  settingsJson: string;
}

export const getConfigPaths = () => invoke<ConfigPaths>("get_config_paths");

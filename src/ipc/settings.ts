import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../types/settings";

export const loadSettings = () => invoke<Settings | null>("load_settings");

export const saveSettings = (settings: Settings) =>
  invoke<void>("save_settings", { args: { settings } });

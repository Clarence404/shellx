import { create } from "zustand";
import type { Settings } from "../types/settings";
import {
  DEFAULT_SETTINGS,
  SYSTEM_FONT_SIZE_MIN, SYSTEM_FONT_SIZE_MAX,
  FILES_FONT_SIZE_MIN, FILES_FONT_SIZE_MAX,
  VALID_THEMES,
} from "../types/settings";
import { loadSettings, saveSettings } from "../ipc/settings";

interface State extends Settings {
  load(): Promise<void>;
  setTheme(id: Settings["themeId"]): void;
  setDensity(id: Settings["density"]): void;
  setSystemFont(id: Settings["systemFont"]): void;
  setSystemFontSize(size: number): void;
  setFilesFontSize(size: number): void;
  setTerminalFontFamily(id: Settings["terminal"]["fontFamily"]): void;
  setTerminalFontSize(size: number): void;
  setTerminalCursorStyle(style: Settings["terminal"]["cursorStyle"]): void;
  localShell: string;
  setLocalShell(v: string): void;
  reset(): void;
}

const SAVE_DEBOUNCE_MS = 300;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function snapshotForSave(s: State): Settings {
  return {
    themeId: s.themeId,
    density: s.density,
    systemFont: s.systemFont,
    systemFontSize: s.systemFontSize,
    filesFontSize: s.filesFontSize,
    terminal: s.terminal,
    localShell: s.localShell || undefined,
    schemaVersion: s.schemaVersion,
  };
}

function scheduleSave(getState: () => State) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveSettings(snapshotForSave(getState()));
  }, SAVE_DEBOUNCE_MS);
}

function immediateSave(getState: () => State) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void saveSettings(snapshotForSave(getState()));
}

export const useSettingsStore = create<State>((set, get) => ({
  ...DEFAULT_SETTINGS,
  localShell: "",

  async load() {
    const loaded = await loadSettings().catch(() => null);
    if (loaded) {
      // Migrate removed theme ids (ocean/forest dropped in v0.5.4) back
      // to the default. Rust stores theme_id as an open String, so a
      // stale settings.json survives the deserialize but hits the UI
      // as an unmatched value that would render no THEME_META card as
      // selected and leave --font-ui pointing at a gone CSS block.
      if (!(VALID_THEMES as ReadonlyArray<string>).includes(loaded.themeId)) {
        loaded.themeId = DEFAULT_SETTINGS.themeId;
      }
      set({ ...loaded, localShell: loaded.localShell ?? "" });
    }
    // If null (missing / malformed), keep DEFAULT_SETTINGS as-is.
  },

  setTheme(id) {
    set({ themeId: id });
    scheduleSave(get);
  },
  setDensity(id) {
    set({ density: id });
    scheduleSave(get);
  },
  setSystemFont(id) {
    set({ systemFont: id });
    scheduleSave(get);
  },
  setSystemFontSize(size) {
    const clamped = Math.max(SYSTEM_FONT_SIZE_MIN, Math.min(SYSTEM_FONT_SIZE_MAX, Math.round(size)));
    set({ systemFontSize: clamped });
    scheduleSave(get);
  },
  setFilesFontSize(size) {
    const clamped = Math.max(FILES_FONT_SIZE_MIN, Math.min(FILES_FONT_SIZE_MAX, Math.round(size)));
    set({ filesFontSize: clamped });
    scheduleSave(get);
  },
  setTerminalFontFamily(id) {
    set((st) => ({ terminal: { ...st.terminal, fontFamily: id } }));
    scheduleSave(get);
  },
  setTerminalFontSize(size) {
    const clamped = Math.max(10, Math.min(20, Math.round(size)));
    set((st) => ({ terminal: { ...st.terminal, fontSize: clamped } }));
    scheduleSave(get);
  },
  setTerminalCursorStyle(style) {
    set((st) => ({ terminal: { ...st.terminal, cursorStyle: style } }));
    scheduleSave(get);
  },

  setLocalShell(v) {
    set({ localShell: v });
    immediateSave(get);
  },

  reset() {
    set({ ...DEFAULT_SETTINGS });
    immediateSave(get);
  },
}));

export function useIconSizes(): { sm: number; md: number; lg: number } {
  const density = useSettingsStore((s) => s.density);
  switch (density) {
    case "compact":
      return { sm: 11, md: 13, lg: 15 };
    case "spacious":
      return { sm: 14, md: 17, lg: 20 };
    default:
      return { sm: 12, md: 15, lg: 18 };
  }
}

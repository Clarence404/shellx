import { create } from "zustand";
import type { Settings } from "../types/settings";
import { DEFAULT_SETTINGS } from "../types/settings";
import { loadSettings, saveSettings } from "../ipc/settings";

interface State extends Settings {
  load(): Promise<void>;
  setTheme(id: Settings["themeId"]): void;
  setDensity(id: Settings["density"]): void;
  setTerminalFontFamily(id: Settings["terminal"]["fontFamily"]): void;
  setTerminalFontSize(size: number): void;
  setTerminalCursorStyle(style: Settings["terminal"]["cursorStyle"]): void;
  reset(): void;
}

const SAVE_DEBOUNCE_MS = 300;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(getState: () => State) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = getState();
    void saveSettings({
      themeId: s.themeId,
      density: s.density,
      terminal: s.terminal,
      schemaVersion: s.schemaVersion,
    });
  }, SAVE_DEBOUNCE_MS);
}

function immediateSave(getState: () => State) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const s = getState();
  void saveSettings({
    themeId: s.themeId,
    density: s.density,
    terminal: s.terminal,
    schemaVersion: s.schemaVersion,
  });
}

export const useSettingsStore = create<State>((set, get) => ({
  ...DEFAULT_SETTINGS,

  async load() {
    const loaded = await loadSettings().catch(() => null);
    if (loaded) set({ ...loaded });
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

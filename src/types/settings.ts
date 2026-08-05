export interface Settings {
  themeId: "warm-minimal" | "ocean" | "forest";
  density: "compact" | "comfortable" | "spacious";
  terminal: {
    fontFamily: "jetbrains-mono" | "sf-mono" | "fira-code" | "cascadia-code" | "consolas";
    fontSize: number;
    cursorStyle: "block" | "underline" | "bar";
  };
  schemaVersion: 1;
}

export const DEFAULT_SETTINGS: Settings = {
  themeId: "warm-minimal",
  density: "comfortable",
  terminal: {
    fontFamily: "jetbrains-mono",
    fontSize: 13,
    cursorStyle: "block",
  },
  schemaVersion: 1,
};

export const FONT_MAP: Record<Settings["terminal"]["fontFamily"], string> = {
  "jetbrains-mono": '"JetBrains Mono", ui-monospace, monospace',
  "sf-mono": '"SF Mono", ui-monospace, monospace',
  "fira-code": '"Fira Code", ui-monospace, monospace',
  "cascadia-code": '"Cascadia Code", ui-monospace, monospace',
  "consolas": "Consolas, ui-monospace, monospace",
};

// Swatches are the three most-visible tokens: [panel-2, accent, border].
export const THEME_META: Array<{
  id: Settings["themeId"];
  label: string;
  swatch: [string, string, string];
}> = [
  { id: "warm-minimal", label: "Warm Minimal", swatch: ["#1e1c24", "#7c5cff", "#322f3a"] },
  { id: "ocean", label: "Ocean", swatch: ["#1a2233", "#4ea3ff", "#2a2e3a"] },
  { id: "forest", label: "Forest", swatch: ["#1a251c", "#6cc57f", "#2a3230"] },
];

export const DENSITY_META: Array<{ id: Settings["density"]; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
  { id: "spacious", label: "Spacious" },
];

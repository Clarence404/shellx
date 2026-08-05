export interface Settings {
  themeId: "warm-minimal" | "ocean" | "forest" | "warm-light";
  density: "compact" | "comfortable" | "spacious";
  systemFont: "system-default" | "segoe-ui" | "pingfang-sc" | "microsoft-yahei";
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
  systemFont: "system-default",
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

// UI sans font — controls tabs, buttons, HOSTS labels, section headers,
// all the "chrome" text. The mono file-list and terminal fonts are separate.
export const SYSTEM_FONT_MAP: Record<Settings["systemFont"], string> = {
  "system-default": '-apple-system, "Segoe UI", "PingFang SC", sans-serif',
  "segoe-ui":        '"Segoe UI", "Microsoft YaHei", sans-serif',
  "pingfang-sc":     '"PingFang SC", -apple-system, "Microsoft YaHei", sans-serif',
  "microsoft-yahei": '"Microsoft YaHei", "PingFang SC", sans-serif',
};

export const SYSTEM_FONT_META: Array<{ id: Settings["systemFont"]; label: string }> = [
  { id: "system-default",  label: "System default" },
  { id: "segoe-ui",        label: "Segoe UI" },
  { id: "pingfang-sc",     label: "PingFang SC" },
  { id: "microsoft-yahei", label: "Microsoft YaHei" },
];

// Swatches are the three most-visible tokens: [panel-2, accent, border].
export const THEME_META: Array<{
  id: Settings["themeId"];
  label: string;
  swatch: [string, string, string];
}> = [
  { id: "warm-minimal", label: "Warm Minimal", swatch: ["#1e1c24", "#7c5cff", "#322f3a"] },
  { id: "ocean",        label: "Ocean",        swatch: ["#1a2233", "#4ea3ff", "#2a2e3a"] },
  { id: "forest",       label: "Forest",       swatch: ["#1a251c", "#6cc57f", "#2a3230"] },
  { id: "warm-light",   label: "Warm Light",   swatch: ["#ffffff", "#6e4dff", "#dcd8d0"] },
];

export const DENSITY_META: Array<{ id: Settings["density"]; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
  { id: "spacious", label: "Spacious" },
];

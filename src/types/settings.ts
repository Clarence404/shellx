export interface Settings {
  themeId: "warm-minimal" | "warm-light";
  density: "compact" | "comfortable" | "spacious";
  systemFont: "system-default" | "segoe-ui" | "pingfang-sc" | "microsoft-yahei";
  systemFontSize: number;
  filesFontSize: number;
  terminal: {
    fontFamily: "jetbrains-mono" | "sf-mono" | "fira-code" | "cascadia-code" | "consolas";
    fontSize: number;
    cursorStyle: "block" | "underline" | "bar";
  };
  localShell?: string;
  language: "en" | "zh";
  autoUpdateCheck: boolean;
  advanced: AdvancedSettings;
  schemaVersion: 1;
}

/** Power-user knobs (Settings → Advanced). Ranges here must match the
 *  clamps in `AdvancedSettings::sanitized()` on the Rust side — the
 *  backend re-clamps whatever it is handed. */
export interface AdvancedSettings {
  connectTimeoutSecs: number;
  keepaliveIntervalSecs: number;
  keepaliveMax: number;
  sftpConcurrency: number;
  logLevel: "error" | "warn" | "info" | "debug";
  terminalScrollback: number;
  reconnectIntervalSecs: number;
  reconnectMaxAttempts: number;
}

export const DEFAULT_ADVANCED: AdvancedSettings = {
  connectTimeoutSecs: 10,
  keepaliveIntervalSecs: 60,
  keepaliveMax: 3,
  sftpConcurrency: 4,
  logLevel: "info",
  terminalScrollback: 5000,
  reconnectIntervalSecs: 5,
  reconnectMaxAttempts: 10,
};

/** [min, max] per numeric advanced field, shared by the panel's controls
 *  and the store's clamping so the two can't drift. */
export const ADVANCED_RANGES = {
  connectTimeoutSecs: [5, 60],
  keepaliveIntervalSecs: [0, 300],
  keepaliveMax: [1, 10],
  sftpConcurrency: [1, 16],
  terminalScrollback: [500, 50000],
  reconnectIntervalSecs: [1, 60],
  reconnectMaxAttempts: [0, 20],
} as const;

export const LOG_LEVEL_META: Array<{ id: AdvancedSettings["logLevel"]; label: string }> = [
  { id: "error", label: "Error" },
  { id: "warn", label: "Warn" },
  { id: "info", label: "Info" },
  { id: "debug", label: "Debug" },
];

export const DEFAULT_SETTINGS: Settings = {
  themeId: "warm-light",
  density: "comfortable",
  systemFont: "system-default",
  systemFontSize: 13,
  filesFontSize: 13,
  terminal: {
    fontFamily: "jetbrains-mono",
    fontSize: 13,
    cursorStyle: "block",
  },
  language: "en",
  autoUpdateCheck: true,
  advanced: DEFAULT_ADVANCED,
  schemaVersion: 1,
};

export const LANGUAGE_META: Array<{ id: Settings["language"]; label: string }> = [
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
];

// Unified range across every "size" slider in Appearance so identical
// values (e.g. 13 px on both System and Files) put the thumbs at the same
// spot on the track. Terminal keeps its own range because a wider spread
// (10..=20) is standard for terminal legibility on very small / very large
// monitors — it lives in its own section and isn't compared side-by-side.
export const SYSTEM_FONT_SIZE_MIN = 11;
export const SYSTEM_FONT_SIZE_MAX = 18;

export const FILES_FONT_SIZE_MIN = 11;
export const FILES_FONT_SIZE_MAX = 18;

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
  { id: "warm-light",   label: "Light", swatch: ["#FFFFFF", "#4C7CFF", "#E7EAF0"] },
  { id: "warm-minimal", label: "Dark",  swatch: ["#141824", "#7C9BFF", "#262B3A"] },
];

export const VALID_THEMES: ReadonlyArray<Settings["themeId"]> = ["warm-light", "warm-minimal"];

export const DENSITY_META: Array<{ id: Settings["density"]; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
  { id: "spacious", label: "Spacious" },
];

import type { Settings } from "./settings";

/** xterm.js theme block; also usable for mocked terminal previews. */
export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;   red: string;    green: string;   yellow: string;
  blue: string;    magenta: string; cyan: string;   white: string;
  brightBlack: string;   brightRed: string;    brightGreen: string;   brightYellow: string;
  brightBlue: string;    brightMagenta: string; brightCyan: string;   brightWhite: string;
}

/** Terminal palettes that follow the app theme. Same ANSI shape both
 *  sides; only the surface colors + cursor / selection differ.
 *  The real xterm-driven `TerminalView` and the mocked `TerminalPreview`
 *  in Settings → Appearance both consume this so the preview always
 *  matches the live terminal. */
export const TERMINAL_PALETTES: Record<Settings["themeId"], TerminalPalette> = {
  "warm-minimal": {
    background: "#0E1220",
    foreground: "#F1F5F9",
    cursor: "#7C9BFF",
    cursorAccent: "#141824",
    selectionBackground: "rgba(76, 124, 255, 0.30)",
    // green is dark forest so ANSI 42 (green background, used by `ls` for
    // "other-writable" directories) has enough contrast with the light-blue
    // foreground. brightGreen stays a muted mid-tone so ANSI 92 text (bold
    // green — bat / diff / test runners often use it) remains readable on
    // the dark terminal bg.
    black: "#1E2333",   red: "#F87171",  green: "#2F5D42",  yellow: "#FBBF24",
    blue: "#7C9BFF",    magenta: "#C084FC", cyan: "#67E8F9", white: "#CBD5E1",
    brightBlack: "#475569", brightRed: "#FCA5A5", brightGreen: "#86EFAC", brightYellow: "#FDE68A",
    brightBlue: "#93B0FF",  brightMagenta: "#D8B4FE", brightCyan: "#A5F3FC", brightWhite: "#F8FAFC",
  },
  "warm-light": {
    background: "#FAFBFD",
    foreground: "#1E293B",
    cursor: "#4C7CFF",
    cursorAccent: "#FFFFFF",
    selectionBackground: "rgba(76, 124, 255, 0.18)",
    // green is a light mint — used mainly as bg for ow directories; pale
    // enough that the darker blue text on it is fully readable on white.
    // brightGreen stays a deep green so ANSI 92 text (bold green) is
    // legible on the near-white terminal bg.
    black: "#0F172A",   red: "#DC2626",  green: "#A7E1B8",  yellow: "#CA8A04",
    blue: "#2563EB",    magenta: "#9333EA", cyan: "#0891B2", white: "#CBD5E1",
    brightBlack: "#64748B", brightRed: "#EF4444", brightGreen: "#16A34A", brightYellow: "#EAB308",
    brightBlue: "#3B82F6",  brightMagenta: "#A855F7", brightCyan: "#06B6D4", brightWhite: "#F1F5F9",
  },
};

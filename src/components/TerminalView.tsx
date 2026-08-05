import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { onSessionData, onSessionClosed } from "../ipc/events";
import { writeSessionInput, resizeSession } from "../ipc/commands";
import type { SessionId } from "../types/session";
import { useSettingsStore } from "../state/settings";
import { FONT_MAP } from "../types/settings";

export function TerminalView({ sessionId }: { sessionId: SessionId }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminal = useSettingsStore((s) => s.terminal);

  useEffect(() => {
    if (!hostRef.current) return;

    // Guards against the async listener races below: onSessionData/onSessionClosed
    // resolve asynchronously, and the effect can be cleaned up (sessionId change or
    // unmount) before those promises settle. Without this flag, a listener that
    // resolves after cleanup would wire itself up and leak — writing to a disposed
    // Terminal and never getting unsubscribed.
    let cancelled = false;

    // Read persisted settings directly (rather than the `terminal` closure
    // value) so first paint matches whatever was saved, independent of
    // when this effect re-runs relative to the settings store hydrating.
    const initialTerminal = useSettingsStore.getState().terminal;

    const term = new Terminal({
      fontFamily: FONT_MAP[initialTerminal.fontFamily],
      fontSize: initialTerminal.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: initialTerminal.cursorStyle,
      cursorInactiveStyle: "outline",
      convertEol: false,
      scrollback: 5000,
      // v0.5.5: greens shifted to a muted sage. The prior pastel green
      // (#a6e3a1 / #b8ecb0) doubles as a background for `ls`'s "other-
      // writable directory" case (ANSI 42), and its high saturation +
      // luminance washed blue foreground text out to near-invisibility.
      // Sage green de-saturates the hue so both dark text (tw case,
      // very readable — ~7:1) and blue text (ow case, ~2.4:1 but no
      // longer painful thanks to the muted bg) sit legibly on it.
      // Also matches warm-minimal's overall subdued palette better
      // than the previous vivid pastel. Other colours unchanged; they
      // don't hit the same fg/bg combo.
      theme: {
        background: "#1e1c24",
        foreground: "#d4d0dc",
        cursor: "#7c5cff",
        cursorAccent: "#ffffff",
        selectionBackground: "rgba(124,92,255,0.3)",
        black: "#2a2830",
        red: "#f28779",
        green: "#7c9c80",
        yellow: "#f2c8a2",
        blue: "#58d3fc",
        magenta: "#7c5cff",
        cyan: "#89dceb",
        white: "#d4d0dc",
        brightBlack: "#8b869a",
        brightRed: "#ff9080",
        brightGreen: "#95b298",
        brightYellow: "#f5d1af",
        brightBlue: "#68dcf9",
        brightMagenta: "#a08bff",
        brightCyan: "#95e5f0",
        brightWhite: "#eeeaef",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Send user input to backend as bytes.
    const dataDisp = term.onData((s) => {
      const bytes = Array.from(new TextEncoder().encode(s));
      void writeSessionInput(sessionId, bytes);
    });

    // Notify backend of size changes.
    const resizeDisp = term.onResize(({ cols, rows }) => {
      void resizeSession(sessionId, cols, rows);
    });

    // Handle container resize. Guarded against 0-height: when the parent
    // hides this view via `display: none` (activity tab switch), the host
    // element's offsetHeight is 0 and fit() would otherwise divide-by-zero.
    const ro = new ResizeObserver(() => {
      if (hostRef.current && hostRef.current.offsetHeight > 0) fit.fit();
    });
    ro.observe(hostRef.current);

    // Wire incoming data. `cancelled` prevents a listener that resolves after
    // cleanup has already run from registering itself (it would otherwise never
    // be unsubscribed since cleanup already fired unlistenData?.() as a no-op).
    let unlistenData: (() => void) | undefined;
    let unlistenClosed: (() => void) | undefined;
    onSessionData(({ id, data }) => {
      if (id !== sessionId) return;
      term.write(new Uint8Array(data));
    }).then((u) => {
      if (cancelled) {
        u();
        return;
      }
      unlistenData = u;
    });
    onSessionClosed(({ id }) => {
      if (id !== sessionId) return;
      term.write("\r\n\x1b[2m[connection closed]\x1b[0m\r\n");
    }).then((u) => {
      if (cancelled) {
        u();
        return;
      }
      unlistenClosed = u;
    });

    return () => {
      cancelled = true;
      dataDisp.dispose();
      resizeDisp.dispose();
      ro.disconnect();
      unlistenData?.();
      unlistenClosed?.();
      termRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
  }, [sessionId]);

  // Live-reconfigure xterm when appearance settings change (no remount).
  // Font-family/size changes shift character metrics, so re-fit afterward
  // to recompute cols/rows and keep the backend PTY size in sync — but
  // only if the host is actually visible. When the user is on Settings /
  // Files / Protocols views, the tab body is display:none and the host's
  // offsetHeight is 0; fit() there divides by zero. The options are still
  // applied; the ResizeObserver-attached fit() re-runs when the container
  // becomes visible again.
  useEffect(() => {
    if (!termRef.current || !fitRef.current) return;
    termRef.current.options.fontFamily = FONT_MAP[terminal.fontFamily];
    termRef.current.options.fontSize = terminal.fontSize;
    termRef.current.options.cursorStyle = terminal.cursorStyle;
    if (hostRef.current && hostRef.current.offsetHeight > 0) {
      fitRef.current.fit();
    }
  }, [terminal.fontFamily, terminal.fontSize, terminal.cursorStyle]);

  return (
    <div
      ref={hostRef}
      // Background matches xterm's own theme.background (#1e1c24) rather
      // than var(--panel-2). Under the light theme --panel-2 is #ffffff,
      // which turns the 8px padding into a bright white gutter around
      // the dark terminal — inconsistent with how the same padding
      // reads as "extended dark bezel" in dark themes. Pinning it to
      // the terminal palette's own background keeps the visual gap
      // between drawer/toolbar and rendered text identical everywhere.
      style={{ width: "100%", height: "100%", padding: 8, background: "#1e1c24" }}
    />
  );
}

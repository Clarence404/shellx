import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { onSessionClosed } from "../ipc/events";
import { subscribeSession } from "../state/sessionStream";
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
    termRef.current = term;
    fitRef.current = fit;

    // v0.5.7 stale-prompt fix: DON'T fit or write incoming bytes yet
    // if the container has 0-size (typical case: a session was just
    // created while the user is on Files/Settings view — App.tsx keeps
    // the tab body mounted but display:none, so hostRef.current has
    // width/height 0). Fitting at 0-size gives xterm ~10 cols; the
    // shell's welcome prompt gets written wrapped ("root@ubunt") and
    // never rewraps once the container becomes visible. Instead:
    // - Buffer session:data chunks until we've done at least one fit
    //   with valid dimensions.
    // - The ResizeObserver below fires the fit + flushes the buffer
    //   the moment the container gets non-zero size (e.g. when the
    //   user switches to the Hosts view).
    let firstFitDone = false;
    const pendingBytes: Uint8Array[] = [];
    const doFit = () => {
      if (!hostRef.current || hostRef.current.offsetHeight <= 0) return;
      fit.fit();
    };
    const tryInitialFit = () => {
      if (firstFitDone) return;
      if (!hostRef.current || hostRef.current.offsetHeight <= 0) return;
      doFit();
      firstFitDone = true;
      for (const chunk of pendingBytes) term.write(chunk);
      pendingBytes.length = 0;
    };
    // Defer one rAF so xterm's own renderer rAF-init completes first;
    // otherwise fit() can fire before _dimensions is set up, throwing
    // "Cannot read properties of undefined (read 'dimensions')".
    requestAnimationFrame(tryInitialFit);

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
    // Also drives the first-good-fit + buffer-flush machinery: the first
    // time the observer fires with a real size, tryInitialFit() runs the
    // fit AND drains pendingBytes.
    const ro = new ResizeObserver(() => {
      if (!hostRef.current || hostRef.current.offsetHeight <= 0) return;
      if (!firstFitDone) tryInitialFit();
      else doFit();
    });
    ro.observe(hostRef.current);

    // Re-announce terminal dimensions on demand. When a shell is opened
    // late onto an existing session (host switched from tunnels-only to a
    // terminal mode), the PTY starts at the backend default 80x24; the
    // container size hasn't changed so no ResizeObserver tick fires. The
    // dispatcher (ConnectDialog) fires this event after open_shell so the
    // PTY picks up the real cols/rows immediately.
    const onRefit = (ev: Event) => {
      const id = (ev as CustomEvent<string>).detail;
      if (id !== sessionId || !termRef.current) return;
      try { fitRef.current?.fit(); } catch { /* renderer not ready */ }
      const tm = termRef.current;
      void resizeSession(sessionId, tm.cols, tm.rows);
    };
    window.addEventListener("shellx:refit", onRefit);

    // Wire incoming data via the global session:data router. Bytes that
    // arrived before this TerminalView mounted are replayed synchronously
    // inside `subscribeSession` — no more "fresh tab is blank until you
    // hit Enter" from the mount-vs-pump race that plagued the direct
    // `onSessionData` subscribe path.
    const unlistenData = subscribeSession(sessionId, (chunk) => {
      // If we haven't sized the terminal yet, park bytes until the
      // container has a real width. tryInitialFit() flushes them once
      // the ResizeObserver fires with non-zero dimensions.
      if (!firstFitDone) pendingBytes.push(chunk);
      else term.write(chunk);
    });

    // onSessionClosed still fires per-view — it's a one-shot terminal
    // marker, not a byte stream, so no race here worth centralising.
    let unlistenClosed: (() => void) | undefined;
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
      window.removeEventListener("shellx:refit", onRefit);
      unlistenData();
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
  // Files / Serial views, the tab body is display:none and the host's
  // offsetHeight is 0; fit() there divides by zero. The options are still
  // applied; the ResizeObserver-attached fit() re-runs when the container
  // becomes visible again.
  useEffect(() => {
    if (!termRef.current || !fitRef.current) return;
    termRef.current.options.fontFamily = FONT_MAP[terminal.fontFamily];
    termRef.current.options.fontSize = terminal.fontSize;
    termRef.current.options.cursorStyle = terminal.cursorStyle;
    if (hostRef.current && hostRef.current.offsetHeight > 0) {
      try { fitRef.current.fit(); } catch { /* renderer not ready */ }
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

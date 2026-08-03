import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { onSessionData, onSessionClosed } from "../ipc/events";
import { writeSessionInput, resizeSession } from "../ipc/commands";
import type { SessionId } from "../types/session";

export function TerminalView({ sessionId }: { sessionId: SessionId }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    // Guards against the async listener races below: onSessionData/onSessionClosed
    // resolve asynchronously, and the effect can be cleaned up (sessionId change or
    // unmount) before those promises settle. Without this flag, a listener that
    // resolves after cleanup would wire itself up and leak — writing to a disposed
    // Terminal and never getting unsubscribed.
    let cancelled = false;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "SF Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      convertEol: false,
      scrollback: 5000,
      theme: {
        background: "#1e1c24",
        foreground: "#d4d0dc",
        cursor: "#7c5cff",
        cursorAccent: "#ffffff",
        selectionBackground: "rgba(124,92,255,0.3)",
        black: "#2a2830",
        red: "#f28779",
        green: "#a6e3a1",
        yellow: "#f2c8a2",
        blue: "#58d3fc",
        magenta: "#7c5cff",
        cyan: "#89dceb",
        white: "#d4d0dc",
        brightBlack: "#8b869a",
        brightRed: "#ff9080",
        brightGreen: "#b8ecb0",
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

    // Send user input to backend as bytes.
    const dataDisp = term.onData((s) => {
      const bytes = Array.from(new TextEncoder().encode(s));
      void writeSessionInput(sessionId, bytes);
    });

    // Notify backend of size changes.
    const resizeDisp = term.onResize(({ cols, rows }) => {
      void resizeSession(sessionId, cols, rows);
    });

    // Handle container resize.
    const ro = new ResizeObserver(() => fit.fit());
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
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div
      ref={hostRef}
      style={{ width: "100%", height: "100%", padding: 8, background: "var(--panel-2)" }}
    />
  );
}

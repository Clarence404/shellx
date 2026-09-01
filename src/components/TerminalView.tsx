import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { ChevronUp, ChevronDown, X, Copy, ClipboardPaste, TextSelect } from "lucide-react";
import { HostContextMenu } from "./HostContextMenu";
import { needsPasteConfirm } from "../terminal/pasteGuard";
import {
  readText as clipboardReadText,
  writeText as clipboardWriteText,
} from "@tauri-apps/plugin-clipboard-manager";
import "@xterm/xterm/css/xterm.css";
import { onSessionClosed } from "../ipc/events";
import { subscribeSession } from "../state/sessionStream";
import { writeSessionInput, resizeSession } from "../ipc/commands";
import { attachCommandSuggest } from "../terminal/suggest";
import type { SessionId } from "../types/session";
import { useSettingsStore } from "../state/settings";
import { useSessions } from "../state/sessions";
import { FONT_MAP } from "../types/settings";
import { TERMINAL_PALETTES } from "../types/terminal-palette";
import { useT } from "../i18n";

export function TerminalView({ sessionId }: { sessionId: SessionId }) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // The overflow-guarded fit from the mount effect, so the live-settings
  // effect below re-fits the same way rather than calling fit() raw.
  const safeFitRef = useRef<(() => void) | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  /** A paste big enough to deserve a look before it hits the shell. */
  const [pastePending, setPastePending] = useState<string | null>(null);
  const terminal = useSettingsStore((s) => s.terminal);
  const themeId = useSettingsStore((s) => s.themeId);

  function openSearch() {
    setSearchOpen(true);
    // Focus after the bar renders.
    setTimeout(() => searchInputRef.current?.select(), 0);
  }

  function closeSearch() {
    setSearchOpen(false);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  }

  function findNext(q: string) {
    if (q) searchRef.current?.findNext(q);
  }

  function findPrev(q: string) {
    if (q) searchRef.current?.findPrevious(q);
  }

  function copySelection() {
    const sel = termRef.current?.getSelection();
    // The Tauri plugin talks to the OS clipboard directly —
    // navigator.clipboard.readText made WebView2 raise a browser-style
    // permission prompt over the app.
    if (sel) void clipboardWriteText(sel);
  }

  /** Ctrl+Shift+V and the context menu both land here. Anything with a
   *  line break — which the shell would EXECUTE on arrival — or simply
   *  very long goes through a confirmation with a preview first. */
  async function pasteFromClipboard() {
    let text = "";
    try {
      text = await clipboardReadText();
    } catch {
      return; // clipboard unreadable (empty, or holds a non-text item)
    }
    if (!text) return;
    if (needsPasteConfirm(text)) {
      setPastePending(text);
    } else {
      doPaste(text);
    }
  }

  function doPaste(text: string) {
    // Straight to the PTY, deliberately WITHOUT bracketed paste:
    // xterm's paste() wraps the text in \x1b[200~ markers when the
    // shell asked for them, and bash 5.1+ then paints the whole paste
    // in reverse video until Enter — which read as a rendering bug.
    // The multi-line-executes-immediately risk those markers guard is
    // already covered by the confirmation dialog above.
    const normalized = text.replace(/\r\n/g, "\r").replace(/\n/g, "\r");
    void writeSessionInput(sessionId, Array.from(new TextEncoder().encode(normalized)));
    setPastePending(null);
    termRef.current?.focus();
  }

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

    const initialTheme = useSettingsStore.getState().themeId;
    const term = new Terminal({
      fontFamily: FONT_MAP[initialTerminal.fontFamily],
      fontSize: initialTerminal.fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: initialTerminal.cursorStyle,
      cursorInactiveStyle: "outline",
      convertEol: false,
      scrollback: useSettingsStore.getState().advanced.terminalScrollback,
      theme: TERMINAL_PALETTES[initialTheme],
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    // Inline command suggestions (fish-style ghost text + → to accept),
    // driven by the locally recorded history. The host element is the
    // positioned ancestor the ghost is placed in.
    const suggest = attachCommandSuggest({
      term,
      container: hostRef.current,
      sessionId,
      getHostKey: () =>
        useSessions.getState().sessions.find((s) => s.id === sessionId)?.host_id ?? "adhoc",
    });

    // Ctrl+Shift+F opens the scrollback search bar. Intercepted at the
    // xterm level so it works while the terminal has keyboard focus
    // (returning false stops xterm from forwarding it to the shell).
    // The suggestion module gets the same hook — xterm allows only one
    // custom key handler, so they share it.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey && (ev.key === "F" || ev.key === "f")) {
        openSearch();
        return false;
      }
      // Terminus-style clipboard chords. Plain Ctrl+C stays SIGINT and
      // plain Ctrl+V stays readline's quoted-insert — only the Shift
      // variants are ours, and both are consumed even when they end up
      // doing nothing (an empty selection must not leak a ^C).
      if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey && (ev.key === "C" || ev.key === "c")) {
        // preventDefault matters: Ctrl+Shift+C/V are ALSO the browser's
        // own copy/paste-as-plain-text chords, and without it the
        // WebView pasted a second copy natively right after ours.
        ev.preventDefault();
        copySelection();
        return false;
      }
      if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey && (ev.key === "V" || ev.key === "v")) {
        ev.preventDefault();
        void pasteFromClipboard();
        return false;
      }
      if (!suggest.handleKey(ev)) return false;
      return true;
    });

    // Same shortcut at window level for when the terminal is visible but
    // not focused. Guarded to the active tab so only one bar opens.
    const onGlobalKey = (ev: KeyboardEvent) => {
      if (!(ev.ctrlKey && ev.shiftKey && (ev.key === "F" || ev.key === "f"))) return;
      if (useSessions.getState().activeId !== sessionId) return;
      if (!hostRef.current || hostRef.current.offsetHeight <= 0) return;
      ev.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onGlobalKey);

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

    // FitAddon picks rows as floor(available / cellHeight), but the height
    // a row actually paints at can be a fraction taller than the value
    // that division used (font metrics settling, device-pixel rounding).
    // The error is per-row, so it scales with the row count: invisible at
    // 40 rows, but past ~70 it exceeds the 14px bottom gutter and eats the
    // last line — which is why this only ever showed up maximised. So
    // after fitting, measure what was actually rendered and give a row
    // back while it overflows.
    const OVERFLOW_GUARD = 3;
    // Only a real overflow is worth a row. Rendered height is an integer
    // while the box it sits in is fractional, so a sub-pixel excess is
    // routine — spending a whole row (~17px) on it is what left too much
    // dead space at the bottom.
    const OVERFLOW_SLACK = 2;
    const doFit = () => {
      const host = hostRef.current;
      if (!host || host.offsetHeight <= 0) return;
      fit.fit();
      const screen = host.querySelector(".xterm-screen") as HTMLElement | null;
      if (!screen) return;
      const style = window.getComputedStyle(host);
      const available = host.clientHeight
        - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      for (let i = 0; i < OVERFLOW_GUARD; i++) {
        if (screen.offsetHeight <= available + OVERFLOW_SLACK || term.rows <= 1) break;
        term.resize(term.cols, term.rows - 1);
      }
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
    safeFitRef.current = doFit;

    // Web fonts land after the first fit. A changed cell height silently
    // invalidates the row count xterm already committed to, so the last
    // row paints past the bottom of the pane — and since overflowing
    // resizes nothing, no ResizeObserver tick ever corrects it. Re-fit
    // once the fonts have settled; if the view is hidden at that moment
    // the observer's own fit covers it when it comes back.
    let fontsHandled = false;
    const refitForFonts = () => {
      if (fontsHandled || !termRef.current || !fitRef.current) return;
      if (!hostRef.current || hostRef.current.offsetHeight <= 0) return;
      fontsHandled = true;
      try { doFit(); } catch { /* renderer not ready */ }
      const tm = termRef.current;
      void resizeSession(sessionId, tm.cols, tm.rows);
    };
    void document.fonts?.ready.then(refitForFonts);
    document.fonts?.addEventListener("loadingdone", refitForFonts);

    // Re-announce terminal dimensions on demand. When a shell is opened
    // late onto an existing session (host switched from tunnels-only to a
    // terminal mode), the PTY starts at the backend default 80x24; the
    // container size hasn't changed so no ResizeObserver tick fires. The
    // dispatcher (ConnectDialog) fires this event after open_shell so the
    // PTY picks up the real cols/rows immediately.
    const onRefit = (ev: Event) => {
      const id = (ev as CustomEvent<string>).detail;
      if (id !== sessionId || !termRef.current) return;
      try { doFit(); } catch { /* renderer not ready */ }
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
      suggest.dispose();
      dataDisp.dispose();
      resizeDisp.dispose();
      document.fonts?.removeEventListener("loadingdone", refitForFonts);
      ro.disconnect();
      window.removeEventListener("shellx:refit", onRefit);
      window.removeEventListener("keydown", onGlobalKey);
      unlistenData();
      unlistenClosed?.();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
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
      try { (safeFitRef.current ?? fitRef.current.fit.bind(fitRef.current))(); }
      catch { /* renderer not ready */ }
    }
  }, [terminal.fontFamily, terminal.fontSize, terminal.cursorStyle]);

  // Follow the app theme: swap xterm palette and the container gutter
  // colour together so the 8px padding around xterm always matches its
  // own theme.background rather than showing a stray strip of app bg.
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = TERMINAL_PALETTES[themeId];
  }, [themeId]);

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%" }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}>
      <div
        ref={hostRef}
        // Gutter (8px padding around xterm) matches the current xterm
        // theme.background, so the padding reads as an extended bezel
        // in either theme. Follows themeId so light-theme users get a
        // white gutter and dark-theme users get a navy one — same
        // terminal background either way.
        style={{
          width: "100%", height: "100%",
          padding: 8, boxSizing: "border-box",
          background: TERMINAL_PALETTES[themeId].background,
        }}
      />
      {searchOpen && (
        <div style={{
          position: "absolute", top: 8, right: 20, zIndex: 20,
          display: "flex", alignItems: "center", gap: 4,
          background: "var(--panel-2)", border: "1px solid var(--border)",
          borderRadius: 6, padding: "4px 6px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
        }}>
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Incremental: extend the current match instead of jumping.
              if (e.target.value) searchRef.current?.findNext(e.target.value, { incremental: true });
              else searchRef.current?.clearDecorations();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) findPrev(query);
              else if (e.key === "Enter") findNext(query);
              else if (e.key === "Escape") closeSearch();
            }}
            placeholder={t("Search")}
            style={{
              width: 180, fontSize: 12, padding: "3px 6px",
              background: "var(--panel-1)", border: "1px solid var(--border)",
              borderRadius: 4, color: "var(--text-1)", outline: "none",
            }}
          />
          <button onClick={() => findPrev(query)} title={t("Previous match") + " (Shift+Enter)"}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-2)", padding: 3, display: "flex", borderRadius: 3 }}>
            <ChevronUp size={14} />
          </button>
          <button onClick={() => findNext(query)} title={t("Next match") + " (Enter)"}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-2)", padding: 3, display: "flex", borderRadius: 3 }}>
            <ChevronDown size={14} />
          </button>
          <button onClick={closeSearch} title={t("Close") + " (Esc)"}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-2)", padding: 3, display: "flex", borderRadius: 3 }}>
            <X size={14} />
          </button>
        </div>
      )}
      {menu && (
        <HostContextMenu
          x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            // Copy only offers itself when there is something to copy —
            // a disabled row would just restate the obvious.
            ...(termRef.current?.hasSelection()
              ? [{
                  label: `${t("Copy")}  (Ctrl+Shift+C)`,
                  icon: <Copy size={12} />,
                  onClick: copySelection,
                }]
              : []),
            {
              label: `${t("Paste")}  (Ctrl+Shift+V)`,
              icon: <ClipboardPaste size={12} />,
              onClick: () => void pasteFromClipboard(),
            },
            { kind: "separator" as const },
            {
              label: t("Select all"),
              icon: <TextSelect size={12} />,
              onClick: () => termRef.current?.selectAll(),
            },
          ]}
        />
      )}
      {pastePending !== null && (
        <PasteConfirm
          text={pastePending}
          onCancel={() => { setPastePending(null); termRef.current?.focus(); }}
          onPaste={() => doPaste(pastePending)}
        />
      )}
    </div>
  );
}

/**
 * The look-before-it-runs dialog for big pastes. Every line break in a
 * pasted block EXECUTES on arrival (unless the remote app negotiated
 * bracketed paste), so a multi-line paste deserves one glance — the
 * same guard Windows Terminal and Terminus put up.
 */
function PasteConfirm({ text, onCancel, onPaste }: {
  text: string;
  onCancel: () => void;
  onPaste: () => void;
}) {
  const t = useT();
  const lines = text.split(/\r\n|\r|\n/).length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-label="confirm paste"
      onClick={onCancel}
      style={{
        position: "absolute", inset: 0, zIndex: 30,
        background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 90%)", padding: "14px 16px",
          background: "var(--panel-2)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 4 }}>
          {t("Paste into the terminal?")}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 8 }}>
          {lines > 1
            ? `${lines} ${t("lines")} · ${text.length} ${t("chars")} — ${t("every line break runs a command the moment it lands")}`
            : `${text.length} ${t("chars")}`}
        </div>
        <pre style={{
          maxHeight: 180, overflow: "auto", margin: 0, marginBottom: 10,
          padding: "6px 8px", borderRadius: 4,
          background: "var(--panel-1)", border: "1px solid var(--border)",
          fontSize: 11, lineHeight: 1.5, color: "var(--text-2)",
          fontFamily: '"JetBrains Mono", var(--font-mono)',
          whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>{text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text}</pre>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            autoFocus
            onClick={onPaste}
            style={{
              flex: 1, height: 28, borderRadius: 5, border: "none",
              background: "var(--accent)", color: "var(--text-on-accent)",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
            {t("Paste")}
          </button>
          <button
            onClick={onCancel}
            style={{
              flex: 1, height: 28, borderRadius: 5, fontSize: 12,
              border: "1px solid var(--border-hi)", background: "transparent",
              color: "var(--text-2)", cursor: "pointer",
            }}>
            {t("Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

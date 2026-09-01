import type { Terminal } from "@xterm/xterm";
import { ShadowLine } from "./shadowLine";
import { historyRecord, historySuggest } from "../ipc/history";
import { writeSessionInput } from "../ipc/commands";
import { useSettingsStore } from "../state/settings";

export interface CommandSuggest {
  /** Wire into `attachCustomKeyEventHandler`; false means the key was
   *  consumed (an accepted suggestion) and must not reach the shell. */
  handleKey(ev: KeyboardEvent): boolean;
  dispose(): void;
}

const FETCH_DEBOUNCE_MS = 80;

/**
 * fish-style inline suggestion for a terminal session: a dim ghost of
 * the best history match is painted after the cursor, and → accepts it.
 *
 * Everything hangs off the shadow input line (see `ShadowLine`): the
 * moment it loses track — Tab, arrows, full-screen apps — the ghost
 * disappears and nothing is recorded until the next line starts. All
 * keys except the accepting → pass through untouched; the terminal
 * must never feel intercepted.
 */
export function attachCommandSuggest(opts: {
  term: Terminal;
  /** The positioned ancestor the ghost is absolutely placed in. */
  container: HTMLElement;
  sessionId: string;
  getHostKey: () => string;
}): CommandSuggest {
  const { term, container, sessionId, getHostKey } = opts;
  const shadow = new ShadowLine();
  let suggestion: string | null = null;
  let dismissed = false;
  let fetchTimer: ReturnType<typeof setTimeout> | null = null;
  let fetchSeq = 0;

  const ghost = document.createElement("div");
  ghost.setAttribute("data-testid", "command-ghost");
  Object.assign(ghost.style, {
    position: "absolute",
    pointerEvents: "none",
    whiteSpace: "pre",
    zIndex: "5",
    opacity: "0.45",
    display: "none",
  } as Partial<CSSStyleDeclaration>);
  container.appendChild(ghost);

  const enabled = () => useSettingsStore.getState().terminal.commandSuggest;

  function hide() {
    suggestion = null;
    ghost.style.display = "none";
  }

  /** The part of the suggestion the user has not typed yet, or null. */
  function remainder(): string | null {
    if (!suggestion || dismissed || !shadow.valid) return null;
    const line = shadow.line;
    if (line.length < 2 || !suggestion.startsWith(line) || suggestion === line) return null;
    return suggestion.slice(line.length);
  }

  function render() {
    const rest = remainder();
    const buf = term.buffer.active;
    // No ghost inside vim/less (alternate screen) or while scrolled up.
    if (!rest || buf.type === "alternate" || buf.viewportY !== buf.baseY) {
      ghost.style.display = "none";
      return;
    }
    const screen = container.querySelector(".xterm-screen") as HTMLElement | null;
    if (!screen || term.cols === 0 || term.rows === 0) {
      ghost.style.display = "none";
      return;
    }
    const cellW = screen.clientWidth / term.cols;
    const cellH = screen.clientHeight / term.rows;
    const sRect = screen.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    // Keep it on this row — a ghost that wraps would repaint the line
    // below and read as real output.
    const roomCols = Math.max(0, term.cols - buf.cursorX - 1);
    if (roomCols === 0) {
      ghost.style.display = "none";
      return;
    }
    ghost.textContent = rest.length > roomCols ? `${rest.slice(0, roomCols - 1)}…` : rest;
    ghost.style.left = `${sRect.left - cRect.left + buf.cursorX * cellW}px`;
    ghost.style.top = `${sRect.top - cRect.top + buf.cursorY * cellH}px`;
    ghost.style.font = `${term.options.fontSize}px ${term.options.fontFamily}`;
    ghost.style.lineHeight = `${cellH}px`;
    ghost.style.color = term.options.theme?.foreground ?? "#9aa1b2";
    ghost.style.display = "block";
  }

  function scheduleFetch() {
    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => {
      fetchTimer = null;
      const line = shadow.line;
      if (!enabled() || !shadow.valid || line.trim().length < 2) {
        hide();
        return;
      }
      const seq = ++fetchSeq;
      historySuggest(getHostKey(), line)
        .then((rows) => {
          // The line may have moved on while the query ran.
          if (seq !== fetchSeq) return;
          suggestion = rows.find((r) => r.startsWith(shadow.line) && r !== shadow.line) ?? null;
          render();
        })
        .catch(() => hide());
    }, FETCH_DEBOUNCE_MS);
  }

  const dataDisp = term.onData((s) => {
    const submitted = shadow.feed(s);
    if (enabled()) {
      for (const cmd of submitted) void historyRecord(getHostKey(), cmd).catch(() => {});
    }
    dismissed = false;
    if (remainder() === null) hide();
    scheduleFetch();
    render();
  });

  // Remote echo moves the cursor after we do — reposition on every
  // rendered frame. Cheap: style writes only while a ghost is showing.
  const renderDisp = term.onRender(() => {
    if (suggestion) render();
  });

  function handleKey(ev: KeyboardEvent): boolean {
    if (ev.type !== "keydown") return true;
    if (ev.key === "ArrowRight" && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
      const rest = remainder();
      if (rest && ghost.style.display !== "none") {
        // Send the completion instead of the arrow; onData never sees
        // it, so the shadow is told by hand.
        void writeSessionInput(sessionId, Array.from(new TextEncoder().encode(rest)));
        shadow.pushText(rest);
        hide();
        return false;
      }
    }
    if (ev.key === "Escape" && suggestion) {
      // Dismiss the ghost, but let Escape through — vim users own it.
      dismissed = true;
      ghost.style.display = "none";
    }
    return true;
  }

  return {
    handleKey,
    dispose() {
      if (fetchTimer) clearTimeout(fetchTimer);
      dataDisp.dispose();
      renderDisp.dispose();
      ghost.remove();
    },
  };
}

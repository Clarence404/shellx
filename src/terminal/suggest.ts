import type { Terminal } from "@xterm/xterm";
import { ShadowLine } from "./shadowLine";
import { historyRecord, historySuggest } from "../ipc/history";
import { writeSessionInput } from "../ipc/commands";
import { useSettingsStore } from "../state/settings";
import { mergeCandidates, type Candidate } from "./suggestSources";

export interface CommandSuggest {
  /** Wire into `attachCustomKeyEventHandler`; false means the key was
   *  consumed by the dropdown and must not reach the shell. */
  handleKey(ev: KeyboardEvent): boolean;
  dispose(): void;
}

const FETCH_DEBOUNCE_MS = 80;
const LIST_MAX_HEIGHT = 208;

/**
 * WindTerm-style command completion for a terminal session: as a line
 * is typed, a dropdown under the cursor offers prefix matches — `h`
 * rows from the locally recorded per-host history, `c` rows from a
 * bundled command dictionary.
 *
 * Everything hangs off the shadow input line (see `ShadowLine`): the
 * moment it loses track — Tab, arrows, full-screen apps — the list
 * disappears and nothing is recorded until the next line starts.
 *
 * Key contract while the list is visible: ↑/↓ move the highlight, Tab
 * accepts (the highlight, or the top row), Enter accepts ONLY after an
 * explicit ↑/↓ — an un-navigated Enter passes through and runs the
 * typed line, so muscle memory never breaks. Esc closes. Every other
 * key passes through untouched.
 */
export function attachCommandSuggest(opts: {
  term: Terminal;
  /** The positioned ancestor the dropdown is absolutely placed in. */
  container: HTMLElement;
  sessionId: string;
  getHostKey: () => string;
}): CommandSuggest {
  const { term, container, sessionId, getHostKey } = opts;
  const shadow = new ShadowLine();
  let candidates: Candidate[] = [];
  /** -1 = nothing armed: Enter stays the shell's. */
  let selIdx = -1;
  let dismissed = false;
  let fetchTimer: ReturnType<typeof setTimeout> | null = null;
  let fetchSeq = 0;

  const list = document.createElement("div");
  list.setAttribute("data-testid", "command-dropdown");
  Object.assign(list.style, {
    position: "absolute",
    zIndex: "6",
    display: "none",
    minWidth: "220px",
    maxWidth: "440px",
    maxHeight: `${LIST_MAX_HEIGHT}px`,
    overflowY: "auto",
    background: "var(--panel-2)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    padding: "3px",
  } as Partial<CSSStyleDeclaration>);
  container.appendChild(list);

  const enabled = () => useSettingsStore.getState().terminal.commandSuggest;
  const visible = () => list.style.display !== "none";

  function hide() {
    candidates = [];
    selIdx = -1;
    list.style.display = "none";
  }

  function accept(idx: number) {
    const cand = candidates[idx];
    const line = shadow.line;
    if (!cand || !cand.text.startsWith(line)) return;
    const rest = cand.text.slice(line.length);
    if (rest) {
      void writeSessionInput(sessionId, Array.from(new TextEncoder().encode(rest)));
      shadow.pushText(rest);
    }
    hide();
  }

  function renderRows() {
    const line = shadow.line;
    list.textContent = "";
    candidates.forEach((c, i) => {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "3px 8px",
        borderRadius: "4px",
        cursor: "pointer",
        background: i === selIdx ? "var(--accent-fade)" : "transparent",
      } as Partial<CSSStyleDeclaration>);
      row.addEventListener("mousedown", (e) => {
        // mousedown, not click: the terminal steals focus on mouseup.
        e.preventDefault();
        accept(i);
      });
      row.addEventListener("mouseenter", () => {
        selIdx = i;
        renderRows();
      });

      const text = document.createElement("span");
      Object.assign(text.style, {
        flex: "1",
        minWidth: "0",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "pre",
        fontSize: "12px",
        fontFamily: '"JetBrains Mono", var(--font-mono)',
        color: "var(--text-2)",
      } as Partial<CSSStyleDeclaration>);
      const typed = document.createElement("b");
      typed.textContent = line;
      typed.style.color = "var(--text-1)";
      text.appendChild(typed);
      text.appendChild(document.createTextNode(c.text.slice(line.length)));

      const badge = document.createElement("span");
      badge.textContent = c.source;
      Object.assign(badge.style, {
        flexShrink: "0",
        width: "14px",
        textAlign: "center",
        fontSize: "10px",
        lineHeight: "15px",
        borderRadius: "3px",
        fontFamily: "var(--font-mono)",
        // WindTerm's palette, near enough: warm for history, cool for
        // the command dictionary.
        background: c.source === "h" ? "rgba(240,113,120,0.25)" : "rgba(76,124,255,0.25)",
        color: c.source === "h" ? "var(--error)" : "var(--accent)",
      } as Partial<CSSStyleDeclaration>);

      row.appendChild(text);
      row.appendChild(badge);
      list.appendChild(row);
    });
    // Keep the highlight on screen while ↑/↓ walk past the fold.
    const sel = list.children[selIdx] as HTMLElement | undefined;
    sel?.scrollIntoView({ block: "nearest" });
  }

  function position() {
    const buf = term.buffer.active;
    const screen = container.querySelector(".xterm-screen") as HTMLElement | null;
    if (!screen || term.cols === 0 || term.rows === 0) return hide();
    const cellW = screen.clientWidth / term.cols;
    const cellH = screen.clientHeight / term.rows;
    const sRect = screen.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    // Anchor at the start of what was typed, like an IDE popup.
    const startCol = Math.max(0, buf.cursorX - shadow.line.length);
    const left = sRect.left - cRect.left + startCol * cellW;
    const rowTop = sRect.top - cRect.top + buf.cursorY * cellH;
    list.style.left = `${Math.max(0, Math.min(left, cRect.width - 240))}px`;
    // Below the cursor row when there is room, above it when not.
    const roomBelow = cRect.height - (rowTop + cellH);
    if (roomBelow >= Math.min(LIST_MAX_HEIGHT, list.scrollHeight) + 4) {
      list.style.top = `${rowTop + cellH + 2}px`;
      list.style.bottom = "";
    } else {
      list.style.top = "";
      list.style.bottom = `${cRect.height - rowTop + 2}px`;
    }
  }

  function show() {
    const buf = term.buffer.active;
    if (
      candidates.length === 0 ||
      dismissed ||
      !shadow.valid ||
      buf.type === "alternate" ||
      buf.viewportY !== buf.baseY
    ) {
      list.style.display = "none";
      return;
    }
    renderRows();
    list.style.display = "block";
    position();
  }

  function scheduleFetch() {
    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => {
      fetchTimer = null;
      const line = shadow.line;
      if (!enabled() || !shadow.valid || dismissed || line.trim().length < 2) {
        hide();
        return;
      }
      const seq = ++fetchSeq;
      historySuggest(getHostKey(), line)
        .then((rows) => {
          if (seq !== fetchSeq) return;
          const line2 = shadow.line;
          if (line2 !== line) return; // moved on while the query ran
          candidates = mergeCandidates(line2, rows);
          selIdx = -1;
          show();
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
    hide();
    scheduleFetch();
  });

  // Remote echo moves the cursor after we do — keep the anchor pinned.
  const renderDisp = term.onRender(() => {
    if (visible()) position();
  });

  function handleKey(ev: KeyboardEvent): boolean {
    if (ev.type !== "keydown" || !visible()) return true;
    if (ev.key === "ArrowDown") {
      selIdx = (selIdx + 1) % candidates.length;
      renderRows();
      return false;
    }
    if (ev.key === "ArrowUp") {
      selIdx = selIdx <= 0 ? candidates.length - 1 : selIdx - 1;
      renderRows();
      return false;
    }
    if (ev.key === "Tab") {
      ev.preventDefault();
      accept(selIdx >= 0 ? selIdx : 0);
      return false;
    }
    if (ev.key === "Enter" && selIdx >= 0) {
      // Enter takes the highlight only after an explicit ↑/↓ — an
      // un-navigated Enter still runs the line the user typed.
      accept(selIdx);
      return false;
    }
    if (ev.key === "Escape") {
      dismissed = true;
      hide();
      return false;
    }
    return true;
  }

  return {
    handleKey,
    dispose() {
      if (fetchTimer) clearTimeout(fetchTimer);
      dataDisp.dispose();
      renderDisp.dispose();
      list.remove();
    },
  };
}

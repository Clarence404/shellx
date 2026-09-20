import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { attachCommandSuggest } from "./suggest";
import { historySuggest } from "../ipc/history";
import { writeSessionInput } from "../ipc/commands";

vi.mock("../ipc/history", () => ({
  historyRecord: vi.fn().mockResolvedValue(undefined),
  historySuggest: vi.fn(),
}));
vi.mock("../ipc/commands", () => ({
  writeSessionInput: vi.fn().mockResolvedValue(undefined),
}));

// jsdom doesn't implement scrollIntoView at all.
Element.prototype.scrollIntoView = vi.fn();

/** A container with the `.xterm-screen` child `position()` looks up — without
 *  it, every show() immediately re-hides, which isn't the thing under test
 *  here (that's real xterm DOM, out of scope for this unit). */
function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  container.appendChild(document.createElement("div")).className = "xterm-screen";
  return container;
}

/** Just enough of xterm's Terminal surface for attachCommandSuggest: a
 *  buffer it reads position off, onData/onRender subscriptions, and a way
 *  for the test to simulate a keystroke landing (as the real onData would
 *  once xterm decides to forward it — which is exactly what does NOT happen
 *  for the keys the dropdown consumes; that's the behaviour under test). */
function makeFakeTerm() {
  const dataCbs: Array<(s: string) => void> = [];
  const term = {
    cols: 80,
    rows: 24,
    buffer: { active: { cursorX: 0, cursorY: 0, viewportY: 0, baseY: 0, type: "normal" } },
    onData: (cb: (s: string) => void) => { dataCbs.push(cb); return { dispose() {} }; },
    onRender: () => ({ dispose() {} }),
  } as unknown as Terminal;
  return { term, feed: (s: string) => dataCbs.forEach((cb) => cb(s)) };
}

function keydown(key: string): KeyboardEvent {
  return {
    type: "keydown", key, ctrlKey: false, shiftKey: false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

/** Decodes what a writeSessionInput call actually put on the wire. */
function sentBytes(mockIdx = 0): string {
  const call = vi.mocked(writeSessionInput).mock.calls[mockIdx];
  return new TextDecoder().decode(new Uint8Array(call[1]));
}

describe("attachCommandSuggest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function typeAndWaitForCandidates(feed: (s: string) => void, line: string) {
    vi.mocked(historySuggest).mockResolvedValue(["systemctl status nginx"]);
    feed(line);
    await vi.advanceTimersByTimeAsync(100); // past FETCH_DEBOUNCE_MS
    await Promise.resolve();
    await Promise.resolve();
  }

  it("Enter after an explicit arrow-down fills the missing suffix — never a newline, never runs it", async () => {
    const { term, feed } = makeFakeTerm();
    const suggest = attachCommandSuggest({
      term, container: makeContainer(), sessionId: "s1", getHostKey: () => "h1",
    });
    await typeAndWaitForCandidates(feed, "syst");

    expect(suggest.handleKey(keydown("ArrowDown"))).toBe(false); // consumed by the dropdown
    const enterEv = keydown("Enter");
    expect(suggest.handleKey(enterEv)).toBe(false); // consumed — never reaches the shell
    // Returning false only stops xterm's OWN processing of this keydown; a
    // Chromium/WebView2 textarea still fires a separate `keypress` for
    // Enter afterward unless keydown was actually cancelled, and xterm has
    // its own independent handler for that event which sends a raw \r —
    // executing whatever accept() just filled in. preventDefault() is what
    // suppresses that follow-up keypress; without it this test's other
    // assertions all pass while the real app still executes the line.
    expect(enterEv.preventDefault).toHaveBeenCalled();

    expect(writeSessionInput).toHaveBeenCalledTimes(1);
    const sent = sentBytes();
    expect(sent).toBe("emctl status nginx"); // only the part not yet typed
    expect(sent).not.toMatch(/[\r\n]/); // no newline: this fills in, it does not run

    suggest.dispose();
  });

  it("an un-navigated Enter is left alone, so the typed line still runs as usual", async () => {
    const { term, feed } = makeFakeTerm();
    const suggest = attachCommandSuggest({
      term, container: makeContainer(), sessionId: "s1", getHostKey: () => "h1",
    });
    await typeAndWaitForCandidates(feed, "syst");

    // No ↑/↓ pressed — Enter must pass straight through to the shell.
    expect(suggest.handleKey(keydown("Enter"))).toBe(true);
    expect(writeSessionInput).not.toHaveBeenCalled();

    suggest.dispose();
  });

  it("clicking a row fills the missing suffix the same way — never a newline", async () => {
    const { term, feed } = makeFakeTerm();
    const container = makeContainer();
    document.body.appendChild(container);
    const suggest = attachCommandSuggest({ term, container, sessionId: "s1", getHostKey: () => "h1" });
    await typeAndWaitForCandidates(feed, "syst");

    const row = container.querySelector('[data-testid="command-dropdown"]')!.children[0] as HTMLElement;
    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(writeSessionInput).toHaveBeenCalledTimes(1);
    const sent = sentBytes();
    expect(sent).toBe("emctl status nginx");
    expect(sent).not.toMatch(/[\r\n]/);

    suggest.dispose();
    container.remove();
  });

  it("hovering a row (mouseenter) does not replace the row elements", async () => {
    const { term, feed } = makeFakeTerm();
    const container = makeContainer();
    document.body.appendChild(container);
    const suggest = attachCommandSuggest({ term, container, sessionId: "s1", getHostKey: () => "h1" });
    // Two candidates so there is a second row to hover onto.
    vi.mocked(historySuggest).mockResolvedValue(["systemctl status nginx", "systemctl restart nginx"]);
    feed("syst");
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    const list = container.querySelector('[data-testid="command-dropdown"]')!;
    const rowBefore = list.children[1];
    rowBefore.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    const rowAfter = list.children[1];

    // Same DOM node — a click that started landing on it stays valid even
    // if the pointer entered it a moment earlier.
    expect(rowAfter).toBe(rowBefore);

    suggest.dispose();
    container.remove();
  });
});

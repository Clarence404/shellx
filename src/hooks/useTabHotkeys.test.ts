import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { useTabHotkeys } from "./useTabHotkeys";

function fire(key: string, opts: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...opts }));
}

function mockUserAgent(ua: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
}

const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

describe("useTabHotkeys", () => {
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    const handlers = {
      onNewTab: vi.fn(),
      onCloseTab: vi.fn(),
      onNextTab: vi.fn(),
      onPrevTab: vi.fn(),
    };
    renderHook(() => useTabHotkeys(handlers));
    return handlers;
  }

  it("Windows/Linux: plain Ctrl+T does NOT open a new tab", () => {
    mockUserAgent(WIN_UA);
    const h = setup();
    fire("t", { shiftKey: false });
    expect(h.onNewTab).not.toHaveBeenCalled();
  });

  it("Windows/Linux: plain Ctrl+W does NOT close the tab", () => {
    mockUserAgent(WIN_UA);
    const h = setup();
    fire("w", { shiftKey: false });
    expect(h.onCloseTab).not.toHaveBeenCalled();
  });

  it("Windows/Linux: Ctrl+Shift+T opens a new tab", () => {
    mockUserAgent(WIN_UA);
    const h = setup();
    fire("t", { shiftKey: true });
    expect(h.onNewTab).toHaveBeenCalledOnce();
  });

  it("Windows/Linux: Ctrl+Shift+W closes the tab", () => {
    mockUserAgent(WIN_UA);
    const h = setup();
    fire("w", { shiftKey: true });
    expect(h.onCloseTab).toHaveBeenCalledOnce();
  });

  it("macOS: plain Cmd+T (no shift) still opens a new tab", () => {
    mockUserAgent(MAC_UA);
    const h = setup();
    fire("t", { shiftKey: false, ctrlKey: false, metaKey: true });
    expect(h.onNewTab).toHaveBeenCalledOnce();
  });

  it("macOS: plain Cmd+W (no shift) still closes the tab", () => {
    mockUserAgent(MAC_UA);
    const h = setup();
    fire("w", { shiftKey: false, ctrlKey: false, metaKey: true });
    expect(h.onCloseTab).toHaveBeenCalledOnce();
  });

  it("Ctrl+Tab / Ctrl+Shift+Tab tab switching is unchanged", () => {
    mockUserAgent(WIN_UA);
    const h = setup();
    fire("Tab", { shiftKey: false });
    expect(h.onNextTab).toHaveBeenCalledOnce();
    fire("Tab", { shiftKey: true });
    expect(h.onPrevTab).toHaveBeenCalledOnce();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("./logs", () => ({ logPush: vi.fn().mockResolvedValue(undefined) }));

import { openExternal, externalLinkProps } from "./external";

beforeEach(() => openUrl.mockReset());

describe("openExternal", () => {
  it("hands the url to the OS", async () => {
    openUrl.mockResolvedValue(undefined);
    await openExternal("https://example.com/x");
    expect(openUrl).toHaveBeenCalledWith("https://example.com/x");
  });

  it("swallows a failure — the link is still on screen to copy", async () => {
    // The mock rejects on this one call only: vitest attributes a mock's
    // throw to whichever test is running when it surfaces, so a throwing
    // implementation left in place leaks into the next test.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openUrl.mockImplementationOnce(() => Promise.reject(new Error("no handler")));
    await expect(openExternal("https://example.com")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("shellx: could not open", "https://example.com", expect.any(Error));
    warn.mockRestore();
  });
});

describe("externalLinkProps", () => {
  it("keeps the href so the url can be seen and copied", () => {
    expect(externalLinkProps("https://example.com").href).toBe("https://example.com");
  });

  it("takes the click away from the webview, which would do nothing with it", () => {
    openUrl.mockResolvedValue(undefined);
    const preventDefault = vi.fn();
    externalLinkProps("https://example.com").onClick({ preventDefault } as never);
    expect(preventDefault).toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledWith("https://example.com");
  });
});

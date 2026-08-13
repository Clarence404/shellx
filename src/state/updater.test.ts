import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCheck = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a: unknown[]) => mockCheck(...a) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

import { useUpdater } from "./updater";

describe("updater store", () => {
  beforeEach(() => {
    mockCheck.mockReset();
    useUpdater.setState({ status: "idle", version: null, notes: null, progress: 0, error: null });
  });

  it("check → available when an update exists", async () => {
    mockCheck.mockResolvedValue({ version: "9.9.9", body: "notes", downloadAndInstall: vi.fn() });
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().status).toBe("available");
    expect(useUpdater.getState().version).toBe("9.9.9");
  });

  it("check → upToDate when check returns null", async () => {
    mockCheck.mockResolvedValue(null);
    await useUpdater.getState().check(false);
    expect(useUpdater.getState().status).toBe("upToDate");
  });

  it("silent check failure returns to idle without error", async () => {
    mockCheck.mockRejectedValue(new Error("offline"));
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().status).toBe("idle");
    expect(useUpdater.getState().error).toBeNull();
  });

  it("manual check failure surfaces error", async () => {
    mockCheck.mockRejectedValue(new Error("offline"));
    await useUpdater.getState().check(false);
    expect(useUpdater.getState().status).toBe("error");
    expect(useUpdater.getState().error).toContain("offline");
  });
});

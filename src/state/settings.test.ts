import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore, useIconSizes } from "./settings";
import { DEFAULT_SETTINGS } from "../types/settings";
import { renderHook } from "@testing-library/react";

vi.mock("../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

describe("useSettingsStore", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      ...DEFAULT_SETTINGS,
    } as any);
  });

  it("setAdvanced clamps a value into its declared range", () => {
    const set = useSettingsStore.getState().setAdvanced;
    set("sftpConcurrency", 99);
    expect(useSettingsStore.getState().advanced.sftpConcurrency).toBe(16);
    set("sftpConcurrency", 0);
    expect(useSettingsStore.getState().advanced.sftpConcurrency).toBe(1);
    set("terminalScrollback", 12);
    expect(useSettingsStore.getState().advanced.terminalScrollback).toBe(500);
  });

  it("setAdvanced leaves the whole advanced block otherwise intact", () => {
    useSettingsStore.getState().setAdvanced("logLevel", "debug");
    const a = useSettingsStore.getState().advanced;
    expect(a.logLevel).toBe("debug");
    expect(a.connectTimeoutSecs).toBe(DEFAULT_SETTINGS.advanced.connectTimeoutSecs);
  });

  it("keeps a keepalive interval of 0 as 0 (the disabled setting)", () => {
    useSettingsStore.getState().setAdvanced("keepaliveIntervalSecs", 0);
    expect(useSettingsStore.getState().advanced.keepaliveIntervalSecs).toBe(0);
  });

  it("initialises with DEFAULT_SETTINGS values", () => {
    const s = useSettingsStore.getState();
    expect(s.themeId).toBe(DEFAULT_SETTINGS.themeId);
    expect(s.density).toBe(DEFAULT_SETTINGS.density);
    expect(s.terminal).toEqual(DEFAULT_SETTINGS.terminal);
  });

  it("setTheme mutates themeId", () => {
    useSettingsStore.getState().setTheme("warm-light");
    expect(useSettingsStore.getState().themeId).toBe("warm-light");
  });

  it("setSystemFont mutates systemFont", () => {
    useSettingsStore.getState().setSystemFont("segoe-ui");
    expect(useSettingsStore.getState().systemFont).toBe("segoe-ui");
  });

  it("setSystemFontSize clamps to [11, 18]", () => {
    useSettingsStore.getState().setSystemFontSize(5);
    expect(useSettingsStore.getState().systemFontSize).toBe(11);
    useSettingsStore.getState().setSystemFontSize(99);
    expect(useSettingsStore.getState().systemFontSize).toBe(18);
    useSettingsStore.getState().setSystemFontSize(14);
    expect(useSettingsStore.getState().systemFontSize).toBe(14);
  });

  it("setTerminalFontSize clamps to [10, 20]", () => {
    useSettingsStore.getState().setTerminalFontSize(5);
    expect(useSettingsStore.getState().terminal.fontSize).toBe(10);
    useSettingsStore.getState().setTerminalFontSize(99);
    expect(useSettingsStore.getState().terminal.fontSize).toBe(20);
    useSettingsStore.getState().setTerminalFontSize(15);
    expect(useSettingsStore.getState().terminal.fontSize).toBe(15);
  });

  it("reset() restores DEFAULT_SETTINGS and immediately calls saveSettings", async () => {
    const { saveSettings } = await import("../ipc/settings");
    useSettingsStore.setState({ themeId: "warm-light" } as any);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().themeId).toBe(DEFAULT_SETTINGS.themeId);
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        themeId: DEFAULT_SETTINGS.themeId,
      })
    );
  });
});

describe("useIconSizes", () => {
  beforeEach(() => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS } as any);
  });

  it("returns comfortable sizes by default", () => {
    const { result } = renderHook(() => useIconSizes());
    expect(result.current).toEqual({ sm: 12, md: 15, lg: 18 });
  });

  it("returns compact sizes when density === 'compact'", () => {
    useSettingsStore.setState({ density: "compact" } as any);
    const { result } = renderHook(() => useIconSizes());
    expect(result.current).toEqual({ sm: 11, md: 13, lg: 15 });
  });

  it("returns spacious sizes when density === 'spacious'", () => {
    useSettingsStore.setState({ density: "spacious" } as any);
    const { result } = renderHook(() => useIconSizes());
    expect(result.current).toEqual({ sm: 14, md: 17, lg: 20 });
  });
});

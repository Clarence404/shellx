import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppearancePanel } from "./AppearancePanel";
import { useSettingsStore } from "../../state/settings";
import { DEFAULT_SETTINGS } from "../../types/settings";

vi.mock("../../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

describe("AppearancePanel", () => {
  beforeEach(() => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS } as any);
  });

  it("clicking Warm Light theme card calls setTheme('warm-light')", () => {
    render(<AppearancePanel />);
    fireEvent.click(screen.getByText("Warm Light"));
    expect(useSettingsStore.getState().themeId).toBe("warm-light");
  });

  it("sliding font-size input mutates terminal.fontSize", () => {
    render(<AppearancePanel />);
    const slider = screen.getByLabelText("Terminal font size");
    fireEvent.change(slider, { target: { value: "16" } });
    expect(useSettingsStore.getState().terminal.fontSize).toBe(16);
  });

  it("sliding system font size input mutates systemFontSize", () => {
    render(<AppearancePanel />);
    const slider = screen.getByLabelText("System font size");
    fireEvent.change(slider, { target: { value: "15" } });
    expect(useSettingsStore.getState().systemFontSize).toBe(15);
  });

  it("cursor Underline segmented button switches cursorStyle", () => {
    render(<AppearancePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    expect(useSettingsStore.getState().terminal.cursorStyle).toBe("underline");
  });

  it("System font dropdown mutates systemFont", () => {
    render(<AppearancePanel />);
    const sel = screen.getByLabelText("System font") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "microsoft-yahei" } });
    expect(useSettingsStore.getState().systemFont).toBe("microsoft-yahei");
  });

  it("Forest/Ocean theme cards are no longer offered (dropped in v0.5.3)", () => {
    render(<AppearancePanel />);
    expect(screen.queryByText("Ocean")).toBeNull();
    expect(screen.queryByText("Forest")).toBeNull();
  });
});

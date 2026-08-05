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

  it("clicking Ocean theme card calls setTheme('ocean')", () => {
    render(<AppearancePanel />);
    fireEvent.click(screen.getByText("Ocean"));
    expect(useSettingsStore.getState().themeId).toBe("ocean");
  });

  it("sliding font-size input mutates terminal.fontSize", () => {
    render(<AppearancePanel />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "16" } });
    expect(useSettingsStore.getState().terminal.fontSize).toBe(16);
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

  it("clicking the Warm Light theme card switches themeId", () => {
    render(<AppearancePanel />);
    fireEvent.click(screen.getByText("Warm Light"));
    expect(useSettingsStore.getState().themeId).toBe("warm-light");
  });
});

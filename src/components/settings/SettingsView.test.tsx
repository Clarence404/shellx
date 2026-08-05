import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsView } from "./SettingsView";

vi.mock("../../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

describe("SettingsView", () => {
  it("renders Appearance by default", () => {
    render(<SettingsView />);
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
  });

  it("switches to About when its sidebar row is clicked", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByText("About"));
    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Appearance" })).toBeNull();
  });

  it("Advanced row is dimmed and does not switch section", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByText("Advanced"));
    // Still on Appearance
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
  });
});

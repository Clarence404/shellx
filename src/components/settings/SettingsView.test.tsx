import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsView } from "./SettingsView";
import { useSettingsStore } from "../../state/settings";
import { DEFAULT_ADVANCED } from "../../types/settings";

vi.mock("../../ipc/local_pty", () => ({
  // AppearancePanel enumerates shells on mount; jsdom has no Tauri bridge,
  // and the unhandled rejection otherwise turns the whole run's exit code
  // non-zero even when every test passes.
  listAvailableShells: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

describe("SettingsView", () => {
  beforeEach(() => {
    useSettingsStore.setState({ advanced: { ...DEFAULT_ADVANCED } });
  });

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

  it("Advanced row opens the Advanced panel", () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByText("Advanced"));
    expect(screen.getByRole("heading", { name: "Advanced" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Appearance" })).toBeNull();
    // The panel's own controls, not just its heading.
    expect(screen.getByLabelText("Connect timeout")).toBeInTheDocument();
    expect(screen.getByLabelText("SFTP concurrency")).toBeInTheDocument();
  });

  it("hides the keepalive limit slider when keepalives are off", () => {
    useSettingsStore.getState().setAdvanced("keepaliveIntervalSecs", 0);
    render(<SettingsView />);
    fireEvent.click(screen.getByText("Advanced"));
    expect(screen.getByLabelText("Keepalive interval")).toBeInTheDocument();
    // A probe limit is meaningless when no probes are sent.
    expect(screen.queryByLabelText("Keepalive limit")).toBeNull();
  });
});

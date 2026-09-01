import { render, screen, fireEvent, within } from "@testing-library/react";
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

  it("an available update marks the About row, so the gear's dot has a trail", async () => {
    const { useUpdater } = await import("../../state/updater");
    useUpdater.setState({ status: "available" });
    render(<SettingsView />);
    expect(screen.getByTestId("update-dot")).toBeInTheDocument();
    useUpdater.setState({ status: "idle" });
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
    // The panel's own controls, not just its heading: a typable stepper
    // and a preset group.
    expect(screen.getByLabelText("Connect timeout")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "SFTP concurrency" })).toBeInTheDocument();
  });

  it("hides the keepalive limit slider when keepalives are off", () => {
    useSettingsStore.getState().setAdvanced("keepaliveIntervalSecs", 0);
    render(<SettingsView />);
    fireEvent.click(screen.getByText("Advanced"));
    expect(screen.getByRole("group", { name: "Keepalive interval" })).toBeInTheDocument();
    // A probe limit is meaningless when no probes are sent.
    expect(screen.queryByLabelText("Keepalive limit")).toBeNull();
  });

  it("shows a stored value that is not a preset as its own stop", () => {
    // Hand-edited settings.json: 90s is inside the allowed range but not
    // one of the offered stops, and the row must not read as unselected.
    useSettingsStore.setState({
      advanced: { ...DEFAULT_ADVANCED, keepaliveIntervalSecs: 90 },
    });
    render(<SettingsView />);
    fireEvent.click(screen.getByText("Advanced"));
    const group = screen.getByRole("group", { name: "Keepalive interval" });
    const selected = within(group).getAllByRole("button", { pressed: true });
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe("90s");
  });
});

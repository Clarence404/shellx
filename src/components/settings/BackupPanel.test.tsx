import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackupPanel } from "./BackupPanel";
import { useHostsStore } from "../../state/hosts";
import { exportBundle, previewBundle, importBundle } from "../../ipc/bundle";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { Mock } from "vitest";
import type { BundleHostRow, BundlePreview } from "../../types/bundle";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("../../ipc/bundle", () => ({
  exportBundle: vi.fn(),
  previewBundle: vi.fn(),
  importBundle: vi.fn(),
}));
vi.mock("../../ipc/hosts", () => ({
  listHosts: vi.fn().mockResolvedValue([]),
  keychainAvailable: vi.fn().mockResolvedValue(false),
  saveHost: vi.fn(), updateHost: vi.fn(), deleteHost: vi.fn(),
}));
vi.mock("../../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

function row(over: Partial<BundleHostRow> = {}): BundleHostRow {
  return {
    id: "b1", label: "web", host: "web.example.com", port: 22, username: "deploy",
    notes: null, authMethod: "password", keyPath: null, connectionMode: "terminal_only",
    hasPassword: false, hasPassphrase: false, tunnelCount: 0, duplicate: false,
    ...over,
  };
}

function preview(over: Partial<BundlePreview> = {}): BundlePreview {
  return {
    path: "/tmp/bundle.json", appVersion: "0.21.1", exportedAt: 1_700_000_000_000,
    rows: [], tunnels: 0, hasSettings: false,
    ...over,
  };
}

describe("BackupPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHostsStore.setState({ hosts: [], keychainAvailable: false, loaded: true });
  });
  afterEach(cleanup);

  it("exports to the path the save dialog returned", async () => {
    const user = userEvent.setup();
    (saveDialog as Mock).mockResolvedValue("/tmp/shellx-config.json");
    (exportBundle as Mock).mockResolvedValue({
      path: "/tmp/shellx-config.json", hosts: 3, tunnels: 2,
      settingsIncluded: true, secretsLeftBehind: 0,
    });
    render(<BackupPanel />);

    await user.click(screen.getByRole("button", { name: /Export to file/ }));
    await waitFor(() => expect(exportBundle).toHaveBeenCalledWith("/tmp/shellx-config.json", true));
    expect(await screen.findByText(/Exported/)).toBeInTheDocument();
  });

  it("says how many hosts will have to be given their password again", async () => {
    const user = userEvent.setup();
    (saveDialog as Mock).mockResolvedValue("/tmp/b.json");
    (exportBundle as Mock).mockResolvedValue({
      path: "/tmp/b.json", hosts: 3, tunnels: 0,
      settingsIncluded: false, secretsLeftBehind: 2,
    });
    render(<BackupPanel />);

    await user.click(screen.getByRole("button", { name: /Export to file/ }));
    // The secrets stayed in the keychain, and the panel has to say so.
    expect(await screen.findByText(/hosts will ask for their password again/)).toBeInTheDocument();
  });

  it("leaves settings out when the box is unchecked", async () => {
    const user = userEvent.setup();
    (saveDialog as Mock).mockResolvedValue("/tmp/b.json");
    (exportBundle as Mock).mockResolvedValue({
      path: "/tmp/b.json", hosts: 0, tunnels: 0, settingsIncluded: false, secretsLeftBehind: 0,
    });
    render(<BackupPanel />);

    await user.click(screen.getByRole("checkbox", { name: /Include settings/ }));
    await user.click(screen.getByRole("button", { name: /Export to file/ }));
    await waitFor(() => expect(exportBundle).toHaveBeenCalledWith("/tmp/b.json", false));
  });

  it("writes nothing when the save dialog is dismissed", async () => {
    const user = userEvent.setup();
    (saveDialog as Mock).mockResolvedValue(null);
    render(<BackupPanel />);
    await user.click(screen.getByRole("button", { name: /Export to file/ }));
    await waitFor(() => expect(exportBundle).not.toHaveBeenCalled());
  });

  it("previews a chosen bundle without importing anything", async () => {
    const user = userEvent.setup();
    (openDialog as Mock).mockResolvedValue("/tmp/bundle.json");
    (previewBundle as Mock).mockResolvedValue(
      preview({ rows: [row(), row({ id: "b2", label: "db", tunnelCount: 3 })], tunnels: 3 }),
    );
    render(<BackupPanel />);

    await user.click(screen.getByRole("button", { name: /Choose a bundle/ }));
    expect(await screen.findByText("web")).toBeInTheDocument();
    expect(screen.getByText("db")).toBeInTheDocument();
    // Preview means preview: nothing was written.
    expect(importBundle).not.toHaveBeenCalled();
  });

  it("starts a host that is already here unchecked", async () => {
    const user = userEvent.setup();
    (openDialog as Mock).mockResolvedValue("/tmp/bundle.json");
    (previewBundle as Mock).mockResolvedValue(
      preview({ rows: [row({ duplicate: true }), row({ id: "b2", label: "db" })] }),
    );
    render(<BackupPanel />);

    await user.click(screen.getByRole("button", { name: /Choose a bundle/ }));
    await screen.findByText("Already saved");
    const boxes = screen.getAllByRole("checkbox");
    // [0] include-settings, [1] select-all, [2] web (duplicate), [3] db
    expect((boxes[2] as HTMLInputElement).checked).toBe(false);
    expect((boxes[3] as HTMLInputElement).checked).toBe(true);
  });

  it("imports only the checked hosts, and settings only when asked", async () => {
    const user = userEvent.setup();
    (openDialog as Mock).mockResolvedValue("/tmp/bundle.json");
    (previewBundle as Mock).mockResolvedValue(
      preview({ rows: [row(), row({ id: "b2", label: "db" })], hasSettings: true }),
    );
    (importBundle as Mock).mockResolvedValue({
      hostsAdded: 1, tunnelsAdded: 0, settingsApplied: false, failures: [],
    });
    render(<BackupPanel />);

    await user.click(screen.getByRole("button", { name: /Choose a bundle/ }));
    await screen.findByText("web");
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[3]); // drop db
    await user.click(screen.getByRole("button", { name: /^Import/ }));

    await waitFor(() =>
      expect(importBundle).toHaveBeenCalledWith("/tmp/bundle.json", ["b1"], false));
    expect(await screen.findByText(/Imported/)).toBeInTheDocument();
  });

  it("passes the settings flag through when the box is ticked", async () => {
    const user = userEvent.setup();
    (openDialog as Mock).mockResolvedValue("/tmp/bundle.json");
    (previewBundle as Mock).mockResolvedValue(
      preview({ rows: [row()], hasSettings: true }),
    );
    (importBundle as Mock).mockResolvedValue({
      hostsAdded: 1, tunnelsAdded: 0, settingsApplied: true, failures: [],
    });
    render(<BackupPanel />);

    await user.click(screen.getByRole("button", { name: /Choose a bundle/ }));
    await screen.findByText("web");
    await user.click(screen.getByRole("checkbox", { name: /Also replace my settings/ }));
    await user.click(screen.getByRole("button", { name: /^Import/ }));

    await waitFor(() =>
      expect(importBundle).toHaveBeenCalledWith("/tmp/bundle.json", ["b1"], true));
  });

  it("offers no settings checkbox for a bundle that carries none", async () => {
    const user = userEvent.setup();
    (openDialog as Mock).mockResolvedValue("/tmp/bundle.json");
    (previewBundle as Mock).mockResolvedValue(preview({ rows: [row()], hasSettings: false }));
    render(<BackupPanel />);

    await user.click(screen.getByRole("button", { name: /Choose a bundle/ }));
    await screen.findByText("web");
    expect(screen.queryByRole("checkbox", { name: /Also replace my settings/ })).toBeNull();
  });

  it("surfaces a file that is not a bundle instead of failing silently", async () => {
    const user = userEvent.setup();
    (openDialog as Mock).mockResolvedValue("/tmp/holiday.json");
    (previewBundle as Mock).mockRejectedValue("not a shellx config bundle");
    render(<BackupPanel />);

    await user.click(screen.getByRole("button", { name: /Choose a bundle/ }));
    expect(await screen.findByText(/not a shellx config bundle/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Import/ })).toBeNull();
  });

  it("reports a host that could not be written", async () => {
    const user = userEvent.setup();
    (openDialog as Mock).mockResolvedValue("/tmp/bundle.json");
    (previewBundle as Mock).mockResolvedValue(preview({ rows: [row()] }));
    (importBundle as Mock).mockResolvedValue({
      hostsAdded: 0, tunnelsAdded: 0, settingsApplied: false,
      failures: ["web: database is locked"],
    });
    render(<BackupPanel />);

    await user.click(screen.getByRole("button", { name: /Choose a bundle/ }));
    await screen.findByText("web");
    await user.click(screen.getByRole("button", { name: /^Import/ }));
    expect(await screen.findByText("web: database is locked")).toBeInTheDocument();
  });
});

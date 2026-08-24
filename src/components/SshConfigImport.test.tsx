import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SshConfigImport } from "./SshConfigImport";
import { useHostsStore } from "../state/hosts";
import { scanSshConfig } from "../ipc/sshconfig";
import { saveHost } from "../ipc/hosts";
import type { Mock } from "vitest";
import type { SshConfigScan } from "../types/sshconfig";
import type { HostInfo } from "../types/host";

vi.mock("../ipc/sshconfig", () => ({ scanSshConfig: vi.fn() }));
vi.mock("../ipc/hosts", () => ({
  saveHost: vi.fn(),
  listHosts: vi.fn(),
  keychainAvailable: vi.fn(),
  updateHost: vi.fn(),
  deleteHost: vi.fn(),
}));

function entry(alias: string, over: Partial<SshConfigScan["hosts"][0]> = {}) {
  return {
    alias,
    hostName: `${alias}.example.com`,
    user: "deploy",
    userInferred: false,
    port: 22,
    identityFile: null,
    proxyJump: null,
    ...over,
  };
}

function saved(over: Partial<HostInfo> = {}): HostInfo {
  return {
    id: "h1", label: "web", host: "web.example.com", port: 22, username: "deploy",
    notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
    auth_method: "password", key_path: null, connection_mode: "terminal_only",
    ...over,
  } as HostInfo;
}

function scan(over: Partial<SshConfigScan> = {}): SshConfigScan {
  return { path: "/home/me/.ssh/config", exists: true, hosts: [], skipped: [], ...over };
}

describe("SshConfigImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHostsStore.setState({ hosts: [], keychainAvailable: false, loaded: true });
    (saveHost as Mock).mockImplementation(async (args) => ({
      ...saved(), ...args, id: `id-${args.label}`, password_stored: false,
    }));
  });
  afterEach(cleanup);

  it("lists the hosts it found and writes only the checked ones", async () => {
    const user = userEvent.setup();
    (scanSshConfig as Mock).mockResolvedValue(
      scan({ hosts: [entry("web"), entry("db")] }),
    );
    render(<SshConfigImport open onClose={() => {}} />);

    await screen.findByText("web");
    expect(screen.getByText("db")).toBeInTheDocument();

    // Both are new, so both start checked — uncheck one and import.
    // boxes[0] is select-all, then one per row.
    const boxes = screen.getAllByRole("checkbox");
    await user.click(boxes[2]);
    await user.click(screen.getByRole("button", { name: /^Import/ }));

    await waitFor(() => expect(saveHost).toHaveBeenCalledTimes(1));
    expect((saveHost as Mock).mock.calls[0][0]).toMatchObject({
      label: "web", host: "web.example.com", port: 22, username: "deploy",
      auth_method: "password",
    });
  });

  it("leaves a host that is already saved unchecked", async () => {
    useHostsStore.setState({ hosts: [saved()] });
    (scanSshConfig as Mock).mockResolvedValue(
      scan({ hosts: [entry("web"), entry("db")] }),
    );
    render(<SshConfigImport open onClose={() => {}} />);

    await screen.findByText("Already saved");
    const boxes = screen.getAllByRole("checkbox");
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
    expect((boxes[2] as HTMLInputElement).checked).toBe(true);
    // One selected, so the button offers exactly that.
    expect(screen.getByRole("button", { name: "Import 1" })).toBeInTheDocument();
  });

  it("a key in the config makes the imported host use publickey auth", async () => {
    const user = userEvent.setup();
    (scanSshConfig as Mock).mockResolvedValue(
      scan({ hosts: [entry("web", { identityFile: "/home/me/.ssh/id_ed25519" })] }),
    );
    render(<SshConfigImport open onClose={() => {}} />);

    await screen.findByText("web");
    await user.click(screen.getByRole("button", { name: /^Import/ }));

    await waitFor(() => expect(saveHost).toHaveBeenCalled());
    expect((saveHost as Mock).mock.calls[0][0]).toMatchObject({
      auth_method: "publickey",
      key_path: "/home/me/.ssh/id_ed25519",
    });
  });

  it("says what it skipped and why, instead of dropping it silently", async () => {
    (scanSshConfig as Mock).mockResolvedValue(
      scan({
        hosts: [entry("web")],
        skipped: [
          { pattern: "*.internal", reason: "wildcard" },
          { pattern: "~/.ssh/conf.d/*", reason: "include" },
        ],
      }),
    );
    render(<SshConfigImport open onClose={() => {}} />);

    await screen.findByText("*.internal");
    expect(screen.getByText("pattern, not a machine")).toBeInTheDocument();
    expect(screen.getByText("points at another file")).toBeInTheDocument();
  });

  it("tells the user when there is no config file rather than showing an empty list", async () => {
    (scanSshConfig as Mock).mockResolvedValue(scan({ exists: false }));
    render(<SshConfigImport open onClose={() => {}} />);
    await screen.findByText("No SSH config file found");
    expect(screen.queryByRole("button", { name: /^Import/ })).toBeDisabled();
  });

  it("closes once every checked host landed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    (scanSshConfig as Mock).mockResolvedValue(scan({ hosts: [entry("web")] }));
    render(<SshConfigImport open onClose={onClose} />);

    await screen.findByText("web");
    await user.click(screen.getByRole("button", { name: /^Import/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useHostsStore.getState().hosts.map((h) => h.label)).toEqual(["web"]);
  });

  it("keeps the dialog open and names the host that failed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    (saveHost as Mock).mockRejectedValue(new Error("disk full"));
    (scanSshConfig as Mock).mockResolvedValue(scan({ hosts: [entry("web")] }));
    render(<SshConfigImport open onClose={onClose} />);

    await screen.findByText("web");
    await user.click(screen.getByRole("button", { name: /^Import/ }));
    await screen.findByText(/web: .*disk full/);
    expect(onClose).not.toHaveBeenCalled();
  });
});

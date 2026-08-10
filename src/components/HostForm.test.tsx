import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { HostForm } from "./HostForm";

vi.mock("../state/hosts", () => ({
  useHostsStore: Object.assign(
    () => ({
      keychainAvailable: true,
      addHost: vi.fn().mockResolvedValue({
        id: "id-1", label: "l", host: "h", port: 22, username: "u",
        notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
        auth_method: "password", key_path: null,
        password_stored: true,
      }),
      updateHostById: vi.fn(),
    }),
    { getState: () => ({ keychainAvailable: true }) },
  ),
}));

vi.mock("../ipc/commands", () => ({
  openConnection: vi.fn().mockResolvedValue({
    id: "sess-1", label: "l", kind: "ssh", host_id: null,
  }),
}));

vi.mock("../ipc/keys", () => ({ keysDiscover: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
import { keysDiscover } from "../ipc/keys";
import type { Mock } from "vitest";

describe("HostForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("create mode: renders 'Save & Connect' when Save this host is checked", async () => {
    const onDone = vi.fn();
    render(<HostForm mode="create" onDone={onDone} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /save & connect/i })).toBeInTheDocument();
  });

  it("create mode: unchecking Save this host changes button to 'Connect'", async () => {
    const user = userEvent.setup();
    render(<HostForm mode="create" onDone={() => {}} onCancel={() => {}} />);
    const checkbox = screen.getByRole("checkbox", { name: /save this host/i });
    await user.click(checkbox);
    expect(screen.getByRole("button", { name: /^connect$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save & connect/i })).not.toBeInTheDocument();
  });

  it("edit mode: shows 'Save' button, hides 'Save this host' checkbox", async () => {
    render(<HostForm
      mode="edit"
      initial={{
        id: "id-1", label: "prod-1", host: "10.0.0.1", port: 22,
        username: "chen", notes: null,
        created_at: 0, last_connected_at: null, sort_order: 0,
        auth_method: "password", key_path: null,
      }}
      onDone={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /save this host/i })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("prod-1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10.0.0.1")).toBeInTheDocument();
  });

  it("edit mode: 'Forget stored password' checkbox sends password: null", async () => {
    const user = userEvent.setup();
    const updateHostById = vi.fn().mockResolvedValue({
      id: "id-1", label: "prod-1", host: "10.0.0.1", port: 22, username: "chen",
      notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
      auth_method: "password", key_path: null,
      password_stored: true,
    });
    vi.resetModules();
    vi.doMock("../state/hosts", () => ({
      useHostsStore: Object.assign(
        (selector: any) => selector({
          keychainAvailable: true,
          addHost: vi.fn(),
          updateHostById,
        }),
        { getState: () => ({ keychainAvailable: true }) },
      ),
    }));
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
    const { HostForm: HostFormReloaded } = await import("./HostForm");

    const onDone = vi.fn();
    render(<HostFormReloaded
      mode="edit"
      initial={{
        id: "id-1", label: "prod-1", host: "10.0.0.1", port: 22,
        username: "chen", notes: null,
        created_at: 0, last_connected_at: null, sort_order: 0,
        auth_method: "password", key_path: null,
      }}
      onDone={onDone} onCancel={() => {}} />);

    const checkbox = screen.getByRole("checkbox", { name: /forget stored password/i });
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(updateHostById).toHaveBeenCalledWith(expect.objectContaining({
      id: "id-1", password: null,
    }));
    expect(onDone).toHaveBeenCalledWith("saved");
  });

  it("edit mode: no 'Forget stored password' checkbox when keychain is unavailable", async () => {
    vi.resetModules();
    vi.doMock("../state/hosts", () => ({
      useHostsStore: Object.assign(
        (selector: any) => selector({
          keychainAvailable: false,
          addHost: vi.fn(),
          updateHostById: vi.fn(),
        }),
        { getState: () => ({ keychainAvailable: false }) },
      ),
    }));
    vi.doMock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
    const { HostForm: HostFormReloaded } = await import("./HostForm");
    render(<HostFormReloaded
      mode="edit"
      initial={{
        id: "id-1", label: "prod-1", host: "10.0.0.1", port: 22,
        username: "chen", notes: null,
        created_at: 0, last_connected_at: null, sort_order: 0,
        auth_method: "password", key_path: null,
      }}
      onDone={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole("checkbox", { name: /forget stored password/i })).not.toBeInTheDocument();
  });

  it("defaults to key mode with best key preselected when keys exist", async () => {
    const KEY = (name: string, algo = "ED25519") => ({
      path: `C:/Users/x/.ssh/${name}`, fileName: name, kind: "supported" as const,
      algo, comment: null, encrypted: true,
    });
    (keysDiscover as Mock).mockResolvedValue([KEY("id_ed25519"), KEY("id_rsa", "RSA-4096")]);
    render(<HostForm mode="create" onDone={() => {}} onCancel={() => {}} />);
    expect(await screen.findByText(/id_ed25519/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /密钥文件/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("defaults to password mode when no keys found", async () => {
    (keysDiscover as Mock).mockResolvedValue([]);
    render(<HostForm mode="create" onDone={() => {}} onCancel={() => {}} />);
    await screen.findByRole("button", { name: /密码/ });
    expect(screen.getByRole("button", { name: /密码/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to dropdown picker at five keys", async () => {
    const KEY = (name: string) => ({
      path: `C:/Users/x/.ssh/${name}`, fileName: name, kind: "supported" as const,
      algo: "ED25519", comment: null, encrypted: false,
    });
    (keysDiscover as Mock).mockResolvedValue(["a","b","c","d","e"].map((n) => KEY(`key_${n}`)));
    render(<HostForm mode="create" onDone={() => {}} onCancel={() => {}} />);
    // dropdown trigger shows the selected key; key_e is not visible until opened
    expect(await screen.findByRole("button", { name: /key_a/ })).toBeInTheDocument();
    expect(screen.queryByText(/key_e/)).not.toBeInTheDocument();
  });

  it("ppk keys are visible but disabled with conversion hint", async () => {
    (keysDiscover as Mock).mockResolvedValue([
      { path: "C:/u/.ssh/p.ppk", fileName: "p.ppk", kind: "ppk", algo: null, comment: null, encrypted: false },
    ]);
    render(<HostForm mode="create" onDone={() => {}} onCancel={() => {}} />);
    const chip = await screen.findByText(/p\.ppk/);
    expect(chip.closest("[aria-disabled='true']")).not.toBeNull();
  });
});

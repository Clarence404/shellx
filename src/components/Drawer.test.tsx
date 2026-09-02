import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Drawer } from "./Drawer";
import { useHostsStore } from "../state/hosts";
import { useSessions } from "../state/sessions";
import { deleteHost } from "../ipc/hosts";
import type { Mock } from "vitest";
import type { HostInfo } from "../types/host";

vi.mock("../ipc/hosts", () => ({
  deleteHost: vi.fn().mockResolvedValue(undefined),
  saveHost: vi.fn(), updateHost: vi.fn(),
  listHosts: vi.fn().mockResolvedValue([]),
  keychainAvailable: vi.fn().mockResolvedValue(false),
}));
vi.mock("../ipc/commands", () => ({ closeSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

function host(id: string, label: string): HostInfo {
  return {
    id, label, host: `${label}.example.com`, port: 22, username: "deploy",
    notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
    auth_method: "password", key_path: null, connection_mode: "terminal_only",
  } as HostInfo;
}

const HOSTS = [host("1", "alpha"), host("2", "bravo"), host("3", "charlie"), host("4", "delta")];

function row(label: string) {
  return screen.getByRole("button", { name: label });
}

describe("Drawer multi-select", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useHostsStore.setState({ hosts: [...HOSTS], keychainAvailable: false, loaded: true });
    useSessions.setState({ sessions: [], activeId: null, drawerCollapsed: false, railView: "hosts" });
  });
  afterEach(cleanup);

  it("a plain click still connects and picks nothing", async () => {
    const user = userEvent.setup();
    const onConnectHost = vi.fn();
    render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={onConnectHost} />);

    await user.click(row("bravo"));
    // The row click is deferred ~250ms so a double-click can cancel it.
    await waitFor(() => expect(onConnectHost).toHaveBeenCalled());
    expect(onConnectHost.mock.calls[0][0].label).toBe("bravo");
    expect(screen.getByRole("button", { name: /New connection/ })).toBeInTheDocument();
  });

  it("ctrl-click picks a row instead of connecting", async () => {
    const user = userEvent.setup();
    const onConnectHost = vi.fn();
    render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={onConnectHost} />);

    await user.keyboard("{Control>}");
    await user.click(row("bravo"));
    await user.keyboard("{/Control}");

    expect(onConnectHost).not.toHaveBeenCalled();
    // The footer becomes the batch action, and New connection steps aside.
    expect(await screen.findByRole("button", { name: /Delete 1/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New connection/ })).toBeNull();
  });

  it("shift-click takes the span between the two rows", async () => {
    const user = userEvent.setup();
    render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={() => {}} />);

    await user.keyboard("{Control>}");
    await user.click(row("alpha"));
    await user.keyboard("{/Control}");
    await user.keyboard("{Shift>}");
    await user.click(row("charlie"));
    await user.keyboard("{/Shift}");

    expect(await screen.findByRole("button", { name: /Delete 3/ })).toBeInTheDocument();
  });

  it("Escape puts the drawer back the way it was", async () => {
    const user = userEvent.setup();
    render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={() => {}} />);

    await user.keyboard("{Control>}");
    await user.click(row("bravo"));
    await user.keyboard("{/Control}");
    await screen.findByRole("button", { name: /Delete 1/ });

    await user.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: /New connection/ })).toBeInTheDocument();
  });

  it("deletes every picked host after one confirmation", async () => {
    const user = userEvent.setup();
    render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={() => {}} />);

    await user.keyboard("{Control>}");
    await user.click(row("alpha"));
    await user.click(row("charlie"));
    await user.keyboard("{/Control}");
    await user.click(screen.getByRole("button", { name: /Delete 2/ }));

    // One dialog, naming both, for the pair.
    const dialog = await screen.findByRole("dialog", { name: "confirm delete hosts" });
    expect(dialog).toHaveTextContent("alpha");
    expect(dialog).toHaveTextContent("charlie");
    // The consequences line states facts now: these two hosts have no
    // live sessions and no tunnel rules, and the dialog says exactly that.
    expect(dialog).toHaveTextContent(/No open sessions, no tunnel rules/);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteHost).toHaveBeenCalledTimes(2));
    expect((deleteHost as Mock).mock.calls.map((c) => c[0]).sort()).toEqual(["1", "3"]);
    // Selection is gone with the rows, so the footer returns to normal.
    expect(await screen.findByRole("button", { name: /New connection/ })).toBeInTheDocument();
  });

  it("cancelling the dialog deletes nothing", async () => {
    const user = userEvent.setup();
    render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={() => {}} />);

    await user.keyboard("{Control>}");
    await user.click(row("alpha"));
    await user.keyboard("{/Control}");
    await user.click(screen.getByRole("button", { name: /Delete 1/ }));

    const dialog = await screen.findByRole("dialog", { name: "confirm delete hosts" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(deleteHost).not.toHaveBeenCalled();
    // The picks survive a cancel — you get to change your mind twice.
    expect(screen.getByRole("button", { name: /Delete 1/ })).toBeInTheDocument();
  });

  it("a single host still gets a confirmation, without a name list", async () => {
    const user = userEvent.setup();
    render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={() => {}} />);

    await user.pointer({ keys: "[MouseRight]", target: row("delta") });
    await user.click(await screen.findByText("Delete"));

    const dialog = await screen.findByRole("dialog", { name: "confirm delete hosts" });
    expect(dialog).toHaveTextContent("Delete delta?");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteHost).toHaveBeenCalledWith("4"));
  });

  it("right-clicking outside the selection drops it first", async () => {
    const user = userEvent.setup();
    render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={() => {}} />);

    await user.keyboard("{Control>}");
    await user.click(row("alpha"));
    await user.click(row("bravo"));
    await user.keyboard("{/Control}");
    await screen.findByRole("button", { name: /Delete 2/ });

    // Right-click a row that is not part of the pick: the menu that opens
    // must be the ordinary one, and the pick must be gone — otherwise
    // "Delete" here would quietly mean "delete those other two".
    await user.pointer({ keys: "[MouseRight]", target: row("delta") });
    expect(await screen.findByText("Connect")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete 2/ })).toBeNull();
  });

  it("right-clicking inside the selection offers the batch", async () => {
    const user = userEvent.setup();
    render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={() => {}} />);

    await user.keyboard("{Control>}");
    await user.click(row("alpha"));
    await user.click(row("bravo"));
    await user.keyboard("{/Control}");
    await user.pointer({ keys: "[MouseRight]", target: row("bravo") });

    expect(await screen.findByText("Delete 2 hosts")).toBeInTheDocument();
    expect(screen.queryByText("Connect")).toBeNull();
  });
});

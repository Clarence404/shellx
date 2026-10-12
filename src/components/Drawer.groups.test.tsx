import { render, screen, cleanup, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Drawer } from "./Drawer";
import { useHostsStore } from "../state/hosts";
import { useSessions } from "../state/sessions";
import { updateHost } from "../ipc/hosts";
import type { Mock } from "vitest";
import type { HostInfo } from "../types/host";

vi.mock("../ipc/hosts", () => ({
  deleteHost: vi.fn().mockResolvedValue(undefined),
  saveHost: vi.fn(),
  updateHost: vi.fn(),
  listHosts: vi.fn().mockResolvedValue([]),
  keychainAvailable: vi.fn().mockResolvedValue(false),
}));
vi.mock("../ipc/commands", () => ({ closeSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

function host(id: string, label: string, group: string | null = null): HostInfo {
  return {
    id, label, host: `${label}.example.com`, port: 22, username: "deploy",
    notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
    auth_method: "password", key_path: null, connection_mode: "terminal_only",
    group_name: group,
  };
}

// prod: web1, web2   test: stg   loose: cache, nas
const HOSTS = () => [
  host("1", "web1", "prod"), host("2", "web2", "prod"), host("3", "stg", "test"),
  host("4", "cache"), host("5", "nas"),
];

const row = (label: string) => screen.getByRole("button", { name: label });

/** update_host echoes the host back with the patch applied, like the backend. */
function echoUpdates() {
  (updateHost as Mock).mockImplementation(async (args: { id: string; group_name?: string | null }) => {
    const cur = useHostsStore.getState().hosts.find((h) => h.id === args.id)!;
    return { ...cur, group_name: args.group_name === undefined ? cur.group_name : args.group_name, password_stored: true };
  });
}

function mount(hosts: HostInfo[] = HOSTS(), onConnectHost = vi.fn()) {
  useHostsStore.setState({ hosts, keychainAvailable: false, loaded: true });
  render(<Drawer view="hosts" onNewConnection={() => {}} onConnectHost={onConnectHost} />);
  return onConnectHost;
}

describe("Drawer — groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    echoUpdates();
    useSessions.setState({ sessions: [], activeId: null, drawerCollapsed: false, railView: "hosts" });
  });
  afterEach(cleanup);

  it("with no groups at all it is the flat list it always was", () => {
    mount([host("1", "alpha"), host("2", "bravo")]);
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
    expect(screen.queryByText("Ungrouped")).toBeNull();
    expect(row("alpha")).toBeInTheDocument();
  });

  it("shows each group with its count, hosts under it, and ungrouped hosts last", () => {
    mount();
    const prod = screen.getByRole("button", { name: "prod" });
    expect(prod).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "test" })).toHaveTextContent("1");
    expect(screen.getByText("Ungrouped")).toBeInTheDocument();
    const order = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label")).filter(Boolean);
    expect(order.indexOf("prod")).toBeLessThan(order.indexOf("web1"));
    expect(order.indexOf("web2")).toBeLessThan(order.indexOf("test"));
    expect(order.indexOf("stg")).toBeLessThan(order.indexOf("cache"));
  });

  it("collapses a group on click and remembers it across a remount", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "prod" }));
    expect(screen.queryByRole("button", { name: "web1" })).toBeNull();
    expect(screen.getByRole("button", { name: "prod" })).toHaveAttribute("aria-expanded", "false");

    cleanup();
    mount();
    expect(screen.queryByRole("button", { name: "web1" })).toBeNull();
    expect(screen.getByRole("button", { name: "stg" })).toBeInTheDocument();
  });

  it("dissolving a group ungroups every member and deletes nobody", async () => {
    mount();
    fireEvent.contextMenu(screen.getByRole("button", { name: "prod" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Dissolve group/ }));

    await waitFor(() => expect(updateHost).toHaveBeenCalledTimes(2));
    const calls = (updateHost as Mock).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      { id: "1", group_name: null },
      { id: "2", group_name: null },
    ]);
    expect(useHostsStore.getState().hosts).toHaveLength(5);
  });

  it("renames a group by moving every member to the new name", async () => {
    const user = userEvent.setup();
    mount();
    fireEvent.contextMenu(screen.getByRole("button", { name: "prod" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rename group/ }));

    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("textbox");
    await user.clear(input);
    await user.type(input, "production");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(updateHost).toHaveBeenCalledTimes(2));
    expect((updateHost as Mock).mock.calls.map((c) => c[0])).toEqual([
      { id: "1", group_name: "production" },
      { id: "2", group_name: "production" },
    ]);
  });
});

describe("Drawer — moving hosts into groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    echoUpdates();
    useSessions.setState({ sessions: [], activeId: null, drawerCollapsed: false, railView: "hosts" });
  });
  afterEach(cleanup);

  it("right-click a host → Move to group → an existing group", async () => {
    mount();
    fireEvent.contextMenu(row("cache"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Move to group")).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "prod" }));

    await waitFor(() => expect(updateHost).toHaveBeenCalledWith({ id: "4", group_name: "prod" }));
  });

  it("offers Remove from group only for a host that is in one", async () => {
    mount();
    fireEvent.contextMenu(row("cache"));
    expect(within(await screen.findByRole("menu")).queryByRole("menuitem", { name: /Remove from group/ })).toBeNull();
    cleanup();

    mount();
    fireEvent.contextMenu(row("web1"));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Remove from group/ }));
    await waitFor(() => expect(updateHost).toHaveBeenCalledWith({ id: "1", group_name: null }));
  });

  it("New group… asks for a name, then moves the host into it", async () => {
    const user = userEvent.setup();
    mount();
    fireEvent.contextMenu(row("nas"));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /New group/ }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "home");
    expect(within(dialog).getByText("Creates a new group")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /Create & move/ }));

    await waitFor(() => expect(updateHost).toHaveBeenCalledWith({ id: "5", group_name: "home" }));
  });

  it("Ctrl-select several hosts, then Move N to a group in one go", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}");
    await user.click(row("cache"));
    await user.click(row("nas"));
    await user.keyboard("{/Control}");

    await user.click(await screen.findByRole("button", { name: "Move to group" }));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "test" }));

    await waitFor(() => expect(updateHost).toHaveBeenCalledTimes(2));
    expect((updateHost as Mock).mock.calls.map((c) => c[0])).toEqual([
      { id: "4", group_name: "test" },
      { id: "5", group_name: "test" },
    ]);
    // …and the selection is over.
    await waitFor(() => expect(screen.queryByRole("button", { name: /Delete \d/ })).toBeNull());
  });

  it("a failed move is reported, not swallowed", async () => {
    (updateHost as Mock).mockRejectedValueOnce(new Error("disk full"));
    mount();
    fireEvent.contextMenu(row("cache"));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "prod" }));
    expect(await screen.findByText(/Could not move "cache"/)).toBeInTheDocument();
  });
});

describe("Drawer — selection follows what is visible", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSessions.setState({ sessions: [], activeId: null, drawerCollapsed: false, railView: "hosts" });
  });
  afterEach(cleanup);

  it("a Shift range never sweeps up the members of a collapsed group", async () => {
    const user = userEvent.setup();
    localStorage.setItem("shellx.hostGroupsCollapsed", JSON.stringify(["prod"]));
    mount();
    // Visible: stg, cache, nas.  Hidden: web1, web2.
    await user.keyboard("{Control>}");
    await user.click(row("stg"));
    await user.keyboard("{/Control}");
    await user.keyboard("{Shift>}");
    await user.click(row("nas"));
    await user.keyboard("{/Shift}");

    expect(await screen.findByRole("button", { name: /Delete 3/ })).toBeInTheDocument();
  });

  it("collapsing a group drops its members from an existing selection", async () => {
    const user = userEvent.setup();
    mount();
    await user.keyboard("{Control>}");
    await user.click(row("web1"));
    await user.click(row("cache"));
    await user.keyboard("{/Control}");
    expect(await screen.findByRole("button", { name: /Delete 2/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "prod" }));
    expect(await screen.findByRole("button", { name: /Delete 1/ })).toBeInTheDocument();
  });
});

describe("Drawer — search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSessions.setState({ sessions: [], activeId: null, drawerCollapsed: false, railView: "hosts" });
  });
  afterEach(cleanup);

  const box = () => screen.getByRole("textbox", { name: "Search hosts" });

  it("filters as you type and drops groups with no match", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(box(), "web");
    expect(row("web1")).toBeInTheDocument();
    expect(row("web2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "stg" })).toBeNull();
    expect(screen.queryByRole("button", { name: "test" })).toBeNull();
    expect(screen.queryByRole("button", { name: "cache" })).toBeNull();
  });

  it("matches the address, the username and the group name too", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(box(), "cache.example");
    expect(row("cache")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "web1" })).toBeNull();

    await user.clear(box());
    await user.type(box(), "test");
    expect(row("stg")).toBeInTheDocument(); // by its group name
  });

  it("expands a collapsed group that has a hit", async () => {
    const user = userEvent.setup();
    localStorage.setItem("shellx.hostGroupsCollapsed", JSON.stringify(["prod"]));
    mount();
    expect(screen.queryByRole("button", { name: "web1" })).toBeNull();
    await user.type(box(), "web1");
    expect(row("web1")).toBeInTheDocument();
  });

  it("Esc clears the search and brings everything back", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(box(), "web");
    await user.keyboard("{Escape}");
    expect(box()).toHaveValue("");
    expect(row("cache")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(box(), "zzzz");
    expect(screen.getByText(/No hosts match/)).toBeInTheDocument();
  });

  it("Enter connects the first visible match", async () => {
    const user = userEvent.setup();
    const onConnectHost = mount();
    await user.type(box(), "web");
    await user.keyboard("{Enter}");
    expect(onConnectHost).toHaveBeenCalledTimes(1);
    expect(onConnectHost.mock.calls[0][0].label).toBe("web1");
  });

  it("Enter with no match connects nothing", async () => {
    const user = userEvent.setup();
    const onConnectHost = mount();
    await user.type(box(), "zzzz");
    await user.keyboard("{Enter}");
    expect(onConnectHost).not.toHaveBeenCalled();
  });
});

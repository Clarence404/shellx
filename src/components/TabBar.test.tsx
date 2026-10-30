import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TabBar, type Tab } from "./TabBar";
import { useHostsStore } from "../state/hosts";

const HOST = {
  id: "h1", label: "ubuntu", host: "192.168.126.128", port: 22, username: "root",
  notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
  auth_method: "password", key_path: null,
};

const TABS: Tab[] = [
  { id: "s1", title: "ubuntu", state: "active", kind: "ssh", hostId: "h1" },
  { id: "s2", title: "db01", state: "active", kind: "ssh", hostId: "h2" },
  { id: "s3", title: "Local Terminal", state: "active", kind: "local", hostId: null },
];

function openMenuOn(title: string) {
  fireEvent.contextMenu(screen.getByText(title));
  return within(screen.getByRole("menu"));
}

describe("TabBar context menu", () => {
  beforeEach(() => {
    useHostsStore.setState({ hosts: [HOST] as never });
  });

  it("offers duplicate for a saved host and wires it to forceNew", () => {
    const onConnectHost = vi.fn();
    render(<TabBar tabs={TABS} activeTabId="s1" onSelect={() => {}} onClose={() => {}}
      onConnectHost={onConnectHost} />);
    const menu = openMenuOn("ubuntu");
    fireEvent.click(menu.getByText("Duplicate host"));
    // A second concurrent session to the same host, not a focus switch.
    expect(onConnectHost).toHaveBeenCalledWith(HOST, true);
  });

  it("duplicates a local terminal via the local-terminal handler", () => {
    const onNewLocalTerminal = vi.fn();
    render(<TabBar tabs={TABS} activeTabId="s3" onSelect={() => {}} onClose={() => {}}
      onNewLocalTerminal={onNewLocalTerminal} />);
    const menu = openMenuOn("Local Terminal");
    fireEvent.click(menu.getByText("Duplicate host"));
    expect(onNewLocalTerminal).toHaveBeenCalledTimes(1);
  });

  it("hides duplicate and copy-address when no saved host backs the tab", () => {
    // s2 points at h2, which is not in the store — an ad-hoc connection.
    render(<TabBar tabs={TABS} activeTabId="s2" onSelect={() => {}} onClose={() => {}}
      onConnectHost={() => {}} />);
    const menu = openMenuOn("db01");
    expect(menu.queryByText("Duplicate host")).toBeNull();
    expect(menu.queryByText("Copy address")).toBeNull();
  });

  it("closes just this tab, and the others separately", () => {
    const onClose = vi.fn();
    const onCloseTabs = vi.fn();
    render(<TabBar tabs={TABS} activeTabId="s1" onSelect={() => {}} onClose={onClose}
      onCloseTabs={onCloseTabs} />);
    fireEvent.click(openMenuOn("ubuntu").getByText("Close"));
    expect(onClose).toHaveBeenCalledWith("s1");

    fireEvent.click(openMenuOn("ubuntu").getByText("Close other 2"));
    expect(onCloseTabs).toHaveBeenCalledWith(["s2", "s3"]);
  });

  it("renames in place on Enter and leaves the title alone on Escape", () => {
    const onRename = vi.fn();
    render(<TabBar tabs={TABS} activeTabId="s1" onSelect={() => {}} onClose={() => {}}
      onRename={onRename} />);
    fireEvent.click(openMenuOn("ubuntu").getByText("Rename tab…"));
    const input = screen.getByLabelText("rename tab");
    fireEvent.change(input, { target: { value: "  prod web  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("s1", "prod web");

    onRename.mockClear();
    fireEvent.click(openMenuOn("ubuntu").getByText("Rename tab…"));
    const again = screen.getByLabelText("rename tab");
    fireEvent.change(again, { target: { value: "discarded" } });
    fireEvent.keyDown(again, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("does not offer rename when the parent gave no handler", () => {
    render(<TabBar tabs={TABS} activeTabId="s1" onSelect={() => {}} onClose={() => {}} />);
    expect(openMenuOn("ubuntu").queryByText("Rename tab…")).toBeNull();
  });
});

describe("how a tab shows its connection state", () => {
  /** The dot is the only status mark on a tab; it sits next to the title. */
  function dotOf(title: string): HTMLElement {
    const row = screen.getByText(title).parentElement!;
    const dot = within(row).getAllByText("", { selector: "span" })
      .find((el) => el.style.borderRadius === "50%");
    if (!dot) throw new Error(`no status dot beside ${title}`);
    return dot;
  }

  const render1 = (tab: Tab) =>
    render(<TabBar tabs={[tab]} activeTabId={tab.id} onSelect={() => {}} onClose={() => {}} />);

  it("a live session is green and not dimmed", () => {
    render1({ id: "s1", title: "ubuntu", state: "active", kind: "ssh", hostId: "h1" });
    const dot = dotOf("ubuntu");
    expect(dot.style.background).toBe("var(--success)");
    expect(dot.style.animation).toBe("");
  });

  it("a dropped session is grey and dimmed", () => {
    render1({ id: "s1", title: "ubuntu", state: "closed", kind: "ssh", hostId: "h1" });
    const dot = dotOf("ubuntu");
    expect(dot.style.background).toBe("var(--text-3)");
    expect(dot.style.opacity).toBe("0.4");
  });

  it("a redial in flight reads as connecting, not as gone", () => {
    // The whole point of the fix: pressing reconnect has to show something.
    render1({ id: "s1", title: "ubuntu", state: "closed", reconnecting: true, kind: "ssh", hostId: "h1" });
    const dot = dotOf("ubuntu");
    expect(dot.style.background).toBe("var(--accent)");
    expect(dot.style.animation).toContain("hostrow-pulse");
    expect(dot.style.opacity).toBe("1");
  });

  it("a reconnecting tab stays clickable, so it can be focused while it dials", () => {
    render1({ id: "s1", title: "ubuntu", state: "closed", reconnecting: true, kind: "ssh", hostId: "h1" });
    const row = screen.getByText("ubuntu").closest("div")!.parentElement!;
    expect(row.style.pointerEvents).not.toBe("none");
  });

  it("the flag means nothing once the session is live again", () => {
    render1({ id: "s1", title: "ubuntu", state: "active", reconnecting: true, kind: "ssh", hostId: "h1" });
    expect(dotOf("ubuntu").style.background).toBe("var(--success)");
  });
});

import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PaneLayout } from "./PaneLayout";
import { useSessions } from "../state/sessions";
import { usePaneDrag } from "../state/paneDrag";
import * as tree from "../state/paneTree";
import type { ConnectionInfo } from "../types/connection";

vi.mock("../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

function session(id: string, label: string): ConnectionInfo {
  return { id, label, kind: "ssh", host_id: null, state: "active" } as ConnectionInfo;
}

describe("PaneLayout", () => {
  beforeEach(() => {
    useSessions.setState({
      sessions: [session("a", "ubuntu"), session("b", "db01"), session("c", "web-01")],
      activeId: "a",
      layout: null,
      activeActivity: {},
    });
    usePaneDrag.getState().end();
  });
  afterEach(cleanup);

  it("shows a single pane with no header until the area is split", () => {
    render(<PaneLayout />);
    // One pane, and no pane chrome to explain — there is nothing to tell apart.
    expect(document.querySelectorAll("[data-pane-id]")).toHaveLength(1);
    expect(screen.queryByTitle("Remove from layout")).toBeNull();
  });

  it("renders one box per pane, with headers, once split", () => {
    useSessions.setState({ layout: tree.splitPane(tree.leaf("a"), "a", "right", "b") });
    render(<PaneLayout />);
    const panes = document.querySelectorAll("[data-pane-id]");
    expect(panes).toHaveLength(2);
    expect([...panes].map((p) => p.getAttribute("data-pane-id"))).toEqual(["a", "b"]);
    expect(screen.getAllByTitle("Remove from layout")).toHaveLength(2);
  });

  it("clicking a pane focuses it, which is what activeId means", () => {
    useSessions.setState({ layout: tree.splitPane(tree.leaf("a"), "a", "right", "b") });
    render(<PaneLayout />);
    const paneB = document.querySelector('[data-pane-id="b"]')!;
    fireEvent.pointerDown(paneB);
    expect(useSessions.getState().activeId).toBe("b");
  });

  it("removing a pane from the layout leaves the session open", () => {
    useSessions.setState({ layout: tree.splitPane(tree.leaf("a"), "a", "right", "b") });
    render(<PaneLayout />);
    fireEvent.click(screen.getByLabelText("Remove from layout: db01"));
    // Back to a single pane — and b is still a session, just not on screen.
    expect(useSessions.getState().layout).toBeNull();
    expect(useSessions.getState().sessions.map((s) => s.id)).toContain("b");
    expect(useSessions.getState().activeId).toBe("a");
  });

  it("keeps one host node per session and moves it between panes", () => {
    useSessions.setState({ layout: tree.splitPane(tree.leaf("a"), "a", "right", "b") });
    const { rerender } = render(<PaneLayout />);
    const hostA = document.querySelector('[data-surface="a"]');
    expect(hostA).not.toBeNull();

    // Swap the two panes: the surface must be the very same element
    // afterwards, or an xterm would have been disposed and recreated.
    act(() => { useSessions.getState().swapPanes("a", "b"); });
    rerender(<PaneLayout />);
    expect(document.querySelector('[data-surface="a"]')).toBe(hostA);
    expect(document.querySelectorAll('[data-surface="a"]')).toHaveLength(1);
  });

  it("a pane header press arms a drag without moving anything yet", () => {
    useSessions.setState({ layout: tree.splitPane(tree.leaf("a"), "a", "right", "b") });
    render(<PaneLayout />);
    const header = screen.getByText("db01");
    fireEvent.pointerDown(header, { clientX: 100, clientY: 10 });
    const drag = usePaneDrag.getState();
    expect(drag.sessionId).toBe("b");
    // Still armed, so a plain click stays a click.
    expect(drag.armed).toBe(true);
    expect(useSessions.getState().layout).not.toBeNull();
  });
});

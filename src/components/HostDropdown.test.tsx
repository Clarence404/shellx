import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HostDropdown } from "./HostDropdown";
import { useSessions } from "../state/sessions";
import { useHostsStore } from "../state/hosts";

describe("HostDropdown", () => {
  beforeEach(() => {
    useSessions.setState({ sessions: [], activeId: null, activeActivity: {}, connecting: {}, railView: "hosts" });
    useHostsStore.setState({ hosts: [], keychainAvailable: false, loaded: false });
  });

  it("shows 'Pick a host' when nothing selected", () => {
    render(<HostDropdown currentHost={null} onSelect={() => {}} onNewConnection={() => {}} />);
    expect(screen.getByText("Pick a host")).toBeInTheDocument();
  });

  it("lists quick-connect sessions (no host_id) and fires onSelect", () => {
    useSessions.setState({
      sessions: [{ id: "s1", label: "vm-local", kind: "ssh", host_id: null, state: "active" }],
    });
    const onSelect = vi.fn();
    render(<HostDropdown currentHost={null} onSelect={onSelect} onNewConnection={() => {}} />);
    fireEvent.click(screen.getByText("Pick a host"));
    fireEvent.click(screen.getByText("vm-local"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("lists saved hosts and fires onConnectSavedHost for hosts with no active session", () => {
    const host = {
      id: "h1", label: "prod-1", host: "10.0.0.1", port: 22, username: "chen",
      notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
      auth_method: "password", key_path: null,
    };
    useHostsStore.setState({ hosts: [host], keychainAvailable: false, loaded: true });
    const onConnectSavedHost = vi.fn();
    render(<HostDropdown
      currentHost={null}
      onSelect={() => {}}
      onConnectSavedHost={onConnectSavedHost}
      onNewConnection={() => {}}
    />);
    fireEvent.click(screen.getByText("Pick a host"));
    fireEvent.click(screen.getByText("prod-1"));
    expect(onConnectSavedHost).toHaveBeenCalledWith(host);
  });

  it("saved host with an active session (matched by host_id) fires onSelect, not onConnectSavedHost", () => {
    const host = {
      id: "h1", label: "prod-1", host: "10.0.0.1", port: 22, username: "chen",
      notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
      auth_method: "password", key_path: null,
    };
    useHostsStore.setState({ hosts: [host], keychainAvailable: false, loaded: true });
    useSessions.setState({
      sessions: [{ id: "s1", label: "prod-1", kind: "ssh", host_id: "h1", state: "active" }],
    });
    const onSelect = vi.fn();
    const onConnectSavedHost = vi.fn();
    render(<HostDropdown
      currentHost={null}
      onSelect={onSelect}
      onConnectSavedHost={onConnectSavedHost}
      onNewConnection={() => {}}
    />);
    fireEvent.click(screen.getByText("Pick a host"));
    fireEvent.click(screen.getByText("prod-1"));
    expect(onSelect).toHaveBeenCalledWith("s1");
    expect(onConnectSavedHost).not.toHaveBeenCalled();
  });

  it("fires onNewConnection", () => {
    const onNew = vi.fn();
    render(<HostDropdown currentHost={null} onSelect={() => {}} onNewConnection={onNew} />);
    fireEvent.click(screen.getByText("Pick a host"));
    fireEvent.click(screen.getByText("New connection"));
    expect(onNew).toHaveBeenCalled();
  });

  it("survives a real mousedown-then-click on a list item (mousedown/click race)", () => {
    // Regression: the document-level mousedown listener used to close the
    // popup because the <ul> is a sibling of the trigger button, not a
    // descendant — so mousedown on an <li> closed the list before its click
    // handler fired. A real browser click fires mousedown then click on the
    // same target; fireEvent.click alone doesn't reproduce the race.
    useSessions.setState({
      sessions: [{ id: "s1", label: "vm-local", kind: "ssh", host_id: null, state: "active" }],
    });
    const onSelect = vi.fn();
    render(<HostDropdown currentHost={null} onSelect={onSelect} onNewConnection={() => {}} />);
    fireEvent.click(screen.getByText("Pick a host"));
    const item = screen.getByText("vm-local");
    fireEvent.mouseDown(item);
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith("s1");
  });
});

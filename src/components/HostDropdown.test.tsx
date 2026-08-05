import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HostDropdown } from "./HostDropdown";
import { useSessions } from "../state/sessions";

describe("HostDropdown", () => {
  beforeEach(() => {
    useSessions.setState({ sessions: [], activeId: null, activeActivity: {}, connecting: {}, railView: "hosts" });
  });

  it("shows 'Pick a host' when nothing selected", () => {
    render(<HostDropdown currentHost={null} onSelect={() => {}} onNewConnection={() => {}} />);
    expect(screen.getByText("Pick a host")).toBeInTheDocument();
  });

  it("lists sessions and fires onSelect", () => {
    useSessions.setState({
      sessions: [{ id: "s1", label: "vm-local", kind: "ssh", host_id: null, state: "active" }],
    });
    const onSelect = vi.fn();
    render(<HostDropdown currentHost={null} onSelect={onSelect} onNewConnection={() => {}} />);
    fireEvent.click(screen.getByText("Pick a host"));
    fireEvent.click(screen.getByText("vm-local"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("fires onNewConnection", () => {
    const onNew = vi.fn();
    render(<HostDropdown currentHost={null} onSelect={() => {}} onNewConnection={onNew} />);
    fireEvent.click(screen.getByText("Pick a host"));
    fireEvent.click(screen.getByText("New connection"));
    expect(onNew).toHaveBeenCalled();
  });
});

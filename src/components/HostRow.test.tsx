import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HostRow } from "./HostRow";
import type { HostInfo } from "../types/host";

const HOST: HostInfo = {
  id: "id-1", label: "prod-1", host: "10.0.0.1", port: 22, username: "chen",
  notes: null, created_at: 0, last_connected_at: null, sort_order: 0,
};

describe("HostRow", () => {
  // Single-click on the row is intentionally deferred ~250 ms so a
  // following dblclick can cancel it and route to `onOpenNewShell`
  // instead. Fake timers let each single-click test advance past the
  // debounce without a real wall-clock wait.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders label", () => {
    render(<HostRow host={HOST} isConnected={false}
      onConnect={() => {}} onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}} />);
    expect(screen.getByText("prod-1")).toBeInTheDocument();
  });

  it("clicking the row calls onConnect after the double-click debounce", () => {
    const onConnect = vi.fn();
    render(<HostRow host={HOST} isConnected={false}
      onConnect={onConnect} onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /prod-1/i }));
    // Debounce parked — onConnect fires only after the timer elapses.
    expect(onConnect).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(260); });
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("double-clicking cancels the debounced onConnect and calls onOpenNewShell", () => {
    const onConnect = vi.fn();
    const onOpenNewShell = vi.fn();
    render(<HostRow host={HOST} isConnected={false}
      onConnect={onConnect} onOpenNewShell={onOpenNewShell}
      onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}} />);
    const row = screen.getByRole("button", { name: /prod-1/i });
    fireEvent.click(row);
    fireEvent.doubleClick(row);
    // Advance well past the debounce; onConnect should NOT fire because
    // dblclick cleared the pending timer.
    act(() => { vi.advanceTimersByTime(500); });
    expect(onConnect).not.toHaveBeenCalled();
    expect(onOpenNewShell).toHaveBeenCalledOnce();
  });

  it("bullet has 'connected' aria state when isConnected=true", () => {
    render(<HostRow host={HOST} isConnected={true}
      onConnect={() => {}} onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole("button", { name: /prod-1/i })).toHaveAttribute("aria-describedby", "conn-status-id-1");
    expect(screen.getByTestId("conn-status-id-1")).toHaveAttribute("data-connected", "true");
  });

  it("More button is keyboard-focusable and Enter opens menu", () => {
    render(<HostRow host={HOST} isConnected={false}
      onConnect={() => {}} onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}} />);
    const moreBtn = screen.getByRole("button", { name: /host options/i });
    expect(moreBtn.tagName).toBe("BUTTON");
    expect(moreBtn).toHaveAttribute("tabindex", "0");
    // Not nested inside the row's own connect button — a sibling instead.
    expect(screen.getByRole("button", { name: /prod-1/i })).not.toContainElement(moreBtn);

    moreBtn.focus();
    expect(moreBtn).toHaveFocus();
    fireEvent.keyDown(moreBtn, { key: "Enter" });
    expect(screen.getByRole("menuitem", { name: /connect/i })).toBeInTheDocument();
  });

  it("More button opens menu on Space too", () => {
    render(<HostRow host={HOST} isConnected={false}
      onConnect={() => {}} onEdit={() => {}} onDuplicate={() => {}} onDelete={() => {}} />);
    const moreBtn = screen.getByRole("button", { name: /host options/i });
    fireEvent.keyDown(moreBtn, { key: " " });
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
  });
});

import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransferQueue } from "./TransferQueue";
import { useTransfersStore } from "../state/transfers";

vi.mock("../ipc/transfers", () => ({
  transferCancel: vi.fn(),
}));

const activeTransfer = {
  id: "t1", connection_id: "c1", direction: "upload" as const,
  local_path: "/x/foo.txt", remote_path: "/y/foo.txt",
  total_bytes: 1000, bytes_done: 500,
  state: { kind: "active" as const },
  started_at: 0,
};

describe("TransferQueue", () => {
  beforeEach(() => {
    useTransfersStore.setState({ list: [], loading: false });
  });

  it("renders active transfers filtered by connection", () => {
    useTransfersStore.setState({ list: [activeTransfer] });
    render(<TransferQueue connectionId="c1" />);
    expect(screen.getByText(/foo.txt/i)).toBeInTheDocument();
  });

  it("renders nothing when no transfers for connection", () => {
    useTransfersStore.setState({ list: [activeTransfer] });
    render(<TransferQueue connectionId="other" />);
    expect(screen.queryByText(/foo.txt/i)).not.toBeInTheDocument();
  });

  it("renders nothing initially, then shows the strip once applyStarted fires", () => {
    render(<TransferQueue connectionId="c1" />);
    expect(screen.queryByText(/foo.txt/i)).not.toBeInTheDocument();

    act(() => {
      // Mirrors what the Rust side actually sends on transfer:started: a
      // fresh, not-yet-active TransferInfo for an id the store has never
      // seen (the exact "arrival" path the tests mocking a fixed `list`
      // never exercised -- see final-fixes-brief.md finding 1).
      useTransfersStore.getState().applyStarted({ ...activeTransfer, state: { kind: "queued" } });
    });

    expect(screen.getByText(/foo.txt/i)).toBeInTheDocument();
  });
});

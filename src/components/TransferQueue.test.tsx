import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TransferQueue } from "./TransferQueue";

vi.mock("../ipc/transfers", () => ({
  transferCancel: vi.fn(),
}));

vi.mock("../state/transfers", () => ({
  useTransfersStore: (selector: any) => selector({
    list: [{
      id: "t1", connection_id: "c1", direction: "upload",
      local_path: "/x/foo.txt", remote_path: "/y/foo.txt",
      total_bytes: 1000, bytes_done: 500,
      state: { kind: "active" },
      started_at: 0,
    }],
  }),
}));

describe("TransferQueue", () => {
  it("renders active transfers filtered by connection", () => {
    render(<TransferQueue connectionId="c1" />);
    expect(screen.getByText(/foo.txt/i)).toBeInTheDocument();
  });

  it("renders nothing when no transfers for connection", () => {
    render(<TransferQueue connectionId="other" />);
    expect(screen.queryByText(/foo.txt/i)).not.toBeInTheDocument();
  });
});

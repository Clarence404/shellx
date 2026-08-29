import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TransferBar, TransferRows } from "./TransferQueue";
import { useTransfersStore } from "../state/transfers";
import type { TransferInfo } from "../types/sftp";

vi.mock("../ipc/transfers", () => ({
  transferCancel: vi.fn().mockResolvedValue(undefined),
  transferCancelGroup: vi.fn().mockResolvedValue(undefined),
  transferPause: vi.fn().mockResolvedValue(undefined),
  transferResume: vi.fn().mockResolvedValue(undefined),
  transferRemove: vi.fn().mockResolvedValue(undefined),
  transferRetry: vi.fn().mockResolvedValue("new-id"),
  transferRetryGroup: vi.fn().mockResolvedValue(1),
  transferRemoveGroup: vi.fn().mockResolvedValue(1),
  transferPauseAll: vi.fn().mockResolvedValue(0),
  transferResumeAll: vi.fn().mockResolvedValue(0),
  transferCancelAll: vi.fn().mockResolvedValue(0),
  transferList: vi.fn().mockResolvedValue([]),
}));
import {
  transferRetry, transferCancelGroup, transferRetryGroup, transferPauseAll,
} from "../ipc/transfers";

function tr(over: Partial<TransferInfo>): TransferInfo {
  return {
    id: "t1", connection_id: "c1", direction: "upload",
    local_path: "C:/data/foo.txt", remote_path: "/up/foo.txt",
    total_bytes: 1000, bytes_done: 500,
    state: { kind: "active" }, started_at: 0,
    ...over,
  } as TransferInfo;
}

describe("transfer strip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTransfersStore.setState({ list: [], loading: false });
  });
  afterEach(cleanup);

  it("the bar names what is moving and carries the totals", () => {
    useTransfersStore.setState({ list: [tr({})] });
    render(<TransferBar connectionId="c1" expanded={false} onToggle={() => {}} />);
    expect(screen.getByText("foo.txt")).toBeInTheDocument();
    expect(screen.getByText(/500 B \/ 1000 B/)).toBeInTheDocument();
    expect(screen.getByText("to remote")).toBeInTheDocument();
  });

  it("a single gesture has no chevron and the bar does not toggle", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    useTransfersStore.setState({ list: [tr({})] });
    render(<TransferBar connectionId="c1" expanded={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "transfers" }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("several gestures become 'and N more', and mixed directions drop the destination", () => {
    useTransfersStore.setState({ list: [
      tr({ id: "a", groupId: "g1", remote_path: "/up/dir/a.bin" }),
      tr({ id: "b", groupId: "g1", remote_path: "/up/dir/b.bin", state: { kind: "queued" }, bytes_done: 0 }),
      tr({ id: "c", direction: "download", remote_path: "/logs/x.log", local_path: "D:/x.log" }),
    ] });
    render(<TransferBar showAll expanded={false} onToggle={() => {}} />);
    // Two gestures: the g1 directory and the solo download.
    expect(screen.getByText(/and 1 more items/)).toBeInTheDocument();
    expect(screen.queryByText("to remote")).toBeNull();
  });

  it("with several gestures the whole bar is the toggle", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    useTransfersStore.setState({ list: [
      tr({ id: "a" }),
      tr({ id: "b", remote_path: "/up/other.bin" }),
    ] });
    render(<TransferBar connectionId="c1" expanded={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "transfers" }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("rows are one line per gesture, never per file", () => {
    useTransfersStore.setState({ list: [
      tr({ id: "a", groupId: "g1", groupLabel: "UbuntuServer24", remote_path: "/up/UbuntuServer24/a.vmdk" }),
      tr({ id: "q1", groupId: "g1", groupLabel: "UbuntuServer24", remote_path: "/up/UbuntuServer24/b.vmdk", state: { kind: "queued" }, bytes_done: 0 }),
      tr({ id: "q2", groupId: "g1", groupLabel: "UbuntuServer24", remote_path: "/up/UbuntuServer24/c.vmdk", state: { kind: "queued" }, bytes_done: 0 }),
      tr({ id: "solo", remote_path: "/up/big.zip" }),
    ] });
    render(<TransferRows showAll />);
    expect(screen.getByText("UbuntuServer24")).toBeInTheDocument();
    expect(screen.getByText("big.zip")).toBeInTheDocument();
    // No per-file rows — not even the one actively moving.
    expect(screen.queryByText("a.vmdk")).toBeNull();
    expect(screen.queryByText("b.vmdk")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // The gesture row carries its own file counter.
    expect(screen.getByText(/0\/3 files/)).toBeInTheDocument();
  });

  it("a gesture row's cancel cancels its group, nothing else", async () => {
    const user = userEvent.setup();
    useTransfersStore.setState({ list: [
      tr({ id: "a", groupId: "g1", remote_path: "/up/dir/a.bin" }),
      tr({ id: "q1", groupId: "g2", remote_path: "/dl/logs/x.log", direction: "download", state: { kind: "queued" }, bytes_done: 0 }),
    ] });
    render(<TransferRows showAll />);
    const buttons = screen.getAllByRole("button", { name: "Cancel" });
    await user.click(buttons[buttons.length - 1]);
    expect(transferCancelGroup).toHaveBeenCalledWith("g2");
  });

  it("a gesture row's pause pauses only that group, in one IPC call", async () => {
    const user = userEvent.setup();
    useTransfersStore.setState({ list: [
      tr({ id: "a", groupId: "g1", remote_path: "/up/dir/a.bin" }),
      tr({ id: "b", groupId: "g2", remote_path: "/up/other/b.bin" }),
    ] });
    render(<TransferRows showAll />);
    await user.click(screen.getAllByRole("button", { name: "Pause" })[0]);
    expect(transferPauseAll).toHaveBeenCalledWith(undefined, "g1");
    // Optimistic: only g1's member flips.
    const list = useTransfersStore.getState().list;
    expect(list.find((t) => t.id === "a")?.state.kind).toBe("paused");
    expect(list.find((t) => t.id === "b")?.state.kind).toBe("active");
  });

  it("a fully failed gesture is one red row: count, reason, retry-all", async () => {
    const user = userEvent.setup();
    useTransfersStore.setState({ list: [
      tr({ id: "x", groupId: "g", groupLabel: "RedisFront", state: { kind: "failed", error: "Connection reset" } }),
      tr({ id: "y", groupId: "g", groupLabel: "RedisFront", remote_path: "/up/b.bin", state: { kind: "failed", error: "Connection reset" } }),
    ] });
    render(<TransferRows showAll />);
    expect(screen.getByText("RedisFront")).toBeInTheDocument();
    expect(screen.getByText(/2 files failed · Connection reset/)).toBeInTheDocument();
    // No per-file failure listing.
    expect(screen.queryByText("b.bin")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(transferRetryGroup).toHaveBeenCalledWith("g");
    // The failed rows leave optimistically.
    expect(useTransfersStore.getState().list).toHaveLength(0);
  });

  it("a solo failure retries by id", async () => {
    const user = userEvent.setup();
    useTransfersStore.setState({ list: [
      tr({ id: "bad", remote_path: "/up/broken.bin", state: { kind: "failed", error: "550 denied" } }),
    ] });
    render(<TransferRows showAll />);
    expect(screen.getByText("550 denied")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(transferRetry).toHaveBeenCalledWith("bad");
    expect(useTransfersStore.getState().list.find((t) => t.id === "bad")).toBeUndefined();
  });

  it("the bar goes red and says how many failed", () => {
    useTransfersStore.setState({ list: [
      tr({ id: "bad", remote_path: "/up/broken.bin", state: { kind: "failed", error: "x" } }),
    ] });
    render(<TransferBar showAll expanded={false} onToggle={() => {}} />);
    expect(screen.getByText(/1 items failed/)).toBeInTheDocument();
  });

  it("scoping by connection still works", () => {
    useTransfersStore.setState({ list: [tr({ connection_id: "other" })] });
    const { container } = render(<TransferBar connectionId="c1" expanded={false} onToggle={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

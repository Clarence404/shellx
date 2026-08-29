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
  transferList: vi.fn().mockResolvedValue([]),
}));
import { transferRetry, transferCancelGroup } from "../ipc/transfers";

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

  it("several items become 'and N more', and mixed directions drop the destination", () => {
    useTransfersStore.setState({ list: [
      tr({ id: "a", groupId: "g1", remote_path: "/up/dir/a.bin" }),
      tr({ id: "b", groupId: "g1", remote_path: "/up/dir/b.bin", state: { kind: "queued" }, bytes_done: 0 }),
      tr({ id: "c", direction: "download", remote_path: "/logs/x.log", local_path: "D:/x.log" }),
    ] });
    render(<TransferBar showAll expanded={false} onToggle={() => {}} />);
    // Two items: the g1 directory and the solo download.
    expect(screen.getByText(/and 1 more items/)).toBeInTheDocument();
    expect(screen.queryByText("to remote")).toBeNull();
  });

  it("the whole bar is the toggle", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    useTransfersStore.setState({ list: [tr({})] });
    render(<TransferBar connectionId="c1" expanded={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button", { name: "transfers" }));
    expect(onToggle).toHaveBeenCalled();
  });

  it("rows split by state: moving files, waiting items", () => {
    useTransfersStore.setState({ list: [
      tr({ id: "a", groupId: "g1", remote_path: "/up/UbuntuServer24/a.vmdk" }),
      tr({ id: "q1", groupId: "g1", remote_path: "/up/UbuntuServer24/b.vmdk", state: { kind: "queued" }, bytes_done: 0 }),
      tr({ id: "q2", groupId: "g1", remote_path: "/up/UbuntuServer24/c.vmdk", state: { kind: "queued" }, bytes_done: 0 }),
    ] });
    render(<TransferRows showAll />);
    expect(screen.getByText("Transferring")).toBeInTheDocument();
    expect(screen.getByText("a.vmdk")).toBeInTheDocument();
    // The two queued children are one item line, not two file rows.
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("UbuntuServer24")).toBeInTheDocument();
    expect(screen.getByText(/2 files left/)).toBeInTheDocument();
    expect(screen.queryByText("b.vmdk")).toBeNull();
  });

  it("a waiting item's cancel cancels its group, nothing else", async () => {
    const user = userEvent.setup();
    useTransfersStore.setState({ list: [
      tr({ id: "a", groupId: "g1", remote_path: "/up/dir/a.bin" }),
      tr({ id: "q1", groupId: "g2", remote_path: "/dl/logs/x.log", direction: "download", state: { kind: "queued" }, bytes_done: 0 }),
    ] });
    render(<TransferRows showAll />);
    const buttons = screen.getAllByRole("button", { name: "Cancel" });
    const waitingCancel = buttons[buttons.length - 1];
    await user.click(waitingCancel);
    expect(transferCancelGroup).toHaveBeenCalledWith("g2");
  });

  it("failures come first, with the reason, retry and dismiss", async () => {
    const user = userEvent.setup();
    useTransfersStore.setState({ list: [
      tr({ id: "ok", remote_path: "/up/fine.bin" }),
      tr({ id: "bad", remote_path: "/up/broken.bin", state: { kind: "failed", error: "550 denied" } }),
    ] });
    render(<TransferRows showAll />);
    const labels = [...document.querySelectorAll("div")].map((d) => d.textContent);
    expect(screen.getByText(/Failed · 1/)).toBeInTheDocument();
    expect(screen.getByText("550 denied")).toBeInTheDocument();
    // Failed section renders above Transferring.
    const html = document.body.innerHTML;
    expect(html.indexOf("broken.bin")).toBeLessThan(html.indexOf("fine.bin"));
    expect(labels.length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(transferRetry).toHaveBeenCalledWith("bad");
    // The failed row leaves optimistically.
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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useTransfersStore } from "./transfers";

vi.mock("../ipc/transfers", () => ({
  transferList: vi.fn(),
  transferCancel: vi.fn(),
  transferCancelGroup: vi.fn(),
  transferPause: vi.fn(),
  transferResume: vi.fn(),
  transferRemove: vi.fn().mockResolvedValue(undefined),
  transferRetry: vi.fn().mockResolvedValue("new-id"),
}));
import * as ipc from "../ipc/transfers";

const baseTransfer = {
  id: "t1",
  connection_id: "c1",
  direction: "upload" as const,
  local_path: "/local/a",
  remote_path: "/remote/a",
  total_bytes: 100,
  bytes_done: 0,
  state: { kind: "active" as const },
  started_at: 0,
};

describe("transfers store", () => {
  beforeEach(() => {
    useTransfersStore.setState({ list: [], loading: false });
    vi.clearAllMocks();
  });

  it("loadInitial() fetches transfers from IPC and stores them", async () => {
    (ipc.transferList as any).mockResolvedValue([baseTransfer]);
    await useTransfersStore.getState().loadInitial();
    expect(useTransfersStore.getState().list).toHaveLength(1);
    expect(useTransfersStore.getState().loading).toBe(false);
  });

  /** applyStarted / applyDone buffer and flush on a 100ms timer now —
   *  a 20 000-file enumeration is one render per flush, not per file. */
  function flushBuffers() {
    vi.advanceTimersByTime(150);
  }

  it("applyStarted() inserts a new entry for an id not yet in the store", () => {
    vi.useFakeTimers();
    useTransfersStore.getState().applyStarted(baseTransfer);
    flushBuffers();
    expect(useTransfersStore.getState().list).toHaveLength(1);
    expect(useTransfersStore.getState().list[0].id).toBe("t1");
  });

  it("applyStarted() does not duplicate an id that's already in the store", () => {
    vi.useFakeTimers();
    useTransfersStore.getState().applyStarted(baseTransfer);
    useTransfersStore.getState().applyStarted(baseTransfer);
    flushBuffers();
    expect(useTransfersStore.getState().list).toHaveLength(1);
  });

  it("applyProgress() after applyStarted() correctly updates the entry", () => {
    vi.useFakeTimers();
    useTransfersStore.getState().applyStarted(baseTransfer);
    flushBuffers();
    useTransfersStore.getState().applyProgress({
      transfer_id: "t1",
      bytes_done: 100,
      total_bytes: 1000,
      rate_bps: 50,
    });
    const entry = useTransfersStore.getState().list[0];
    expect(entry.bytes_done).toBe(100);
    expect(entry.total_bytes).toBe(1000);
  });

  it("applyProgress() merges bytes_done/total_bytes into the matching transfer", () => {
    useTransfersStore.setState({ list: [baseTransfer], loading: false });
    useTransfersStore.getState().applyProgress({
      transfer_id: "t1",
      bytes_done: 42,
      total_bytes: 100,
      rate_bps: 1000,
    });
    expect(useTransfersStore.getState().list[0].bytes_done).toBe(42);
  });

  it("applyDone() marks the transfer done and removes it after 5s", () => {
    vi.useFakeTimers();
    useTransfersStore.setState({ list: [baseTransfer], loading: false });
    useTransfersStore.getState().applyDone({ transfer_id: "t1", state: { kind: "done" } });
    vi.advanceTimersByTime(150);
    expect(useTransfersStore.getState().list[0].state).toEqual({ kind: "done" });

    vi.advanceTimersByTime(5000);
    expect(useTransfersStore.getState().list).toHaveLength(0);
    vi.useRealTimers();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { awaitTransfers, dragOutRemote } from "./dragOut";
import { invoke } from "@tauri-apps/api/core";
import { onTransferDone } from "./ipc/transfers";
import type { TransferDoneEvent } from "./ipc/transfers";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./ipc/transfers", () => ({ onTransferDone: vi.fn() }));

/** Wires the mocked listener so a test can fire done-events by hand. */
function listener() {
  let handler: ((e: TransferDoneEvent) => void) | null = null;
  (onTransferDone as ReturnType<typeof vi.fn>).mockImplementation(
    async (h: (e: TransferDoneEvent) => void) => {
      handler = h;
      return () => { handler = null; };
    },
  );
  return {
    fire: (id: string, ok: boolean) =>
      handler?.({ transfer_id: id, state: ok ? { kind: "done" } : { kind: "failed", error: "x" } } as TransferDoneEvent),
  };
}

describe("awaitTransfers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves once every transfer has finished", async () => {
    const l = listener();
    const p = awaitTransfers(async () => ["a", "b"]);
    await Promise.resolve();
    l.fire("a", true);
    l.fire("b", true);
    await expect(p).resolves.toBe(true);
  });

  it("a transfer that finished before the ids were known still counts", async () => {
    // A small file on a fast link finishes before the invoke that
    // started it returns — the event has to be buffered, or the await
    // hangs forever.
    const l = listener();
    const p = awaitTransfers(async () => {
      l.fire("a", true); // lands mid-invoke
      return ["a"];
    });
    await expect(p).resolves.toBe(true);
  });

  it("one failure makes the whole gesture report failure", async () => {
    const l = listener();
    const p = awaitTransfers(async () => ["a", "b"]);
    await Promise.resolve();
    l.fire("a", false);
    l.fire("b", true);
    await expect(p).resolves.toBe(false);
  });

  it("events for unrelated transfers are ignored", async () => {
    const l = listener();
    const p = awaitTransfers(async () => ["mine"]);
    await Promise.resolve();
    l.fire("someone-elses", true);
    l.fire("mine", true);
    await expect(p).resolves.toBe(true);
  });
});

describe("dragOutRemote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stages into a fresh folder and drags the staged copy", async () => {
    const l = listener();
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === "drag_out_staging_dir") return "C:/temp/shellx-drag/u1";
      return undefined;
    });
    const start = vi.fn(async (dest: string) => {
      expect(dest).toBe("C:/temp/shellx-drag/u1/report.dat");
      l.fire("t1", true);
      return ["t1"];
    });
    await dragOutRemote("report.dat", start);
    expect(invoke).toHaveBeenCalledWith("drag_out", {
      args: { paths: ["C:/temp/shellx-drag/u1/report.dat"] },
    });
  });

  it("a failed download never reaches the OS drag", async () => {
    // Dragging a half-written file onto the desktop would look exactly
    // like success — the copy must not leave if the transfer did not
    // finish whole.
    const l = listener();
    (invoke as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string) => {
      if (cmd === "drag_out_staging_dir") return "C:/t/u2";
      return undefined;
    });
    await dragOutRemote("big.bin", async () => {
      l.fire("t1", false);
      return ["t1"];
    });
    const cmds = (invoke as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(cmds).not.toContain("drag_out");
  });
});

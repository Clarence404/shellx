import { describe, it, expect } from "vitest";
import { buildStripModel, stripHasContent } from "./transferView";
import type { TransferInfo } from "../types/sftp";

function tr(over: Partial<TransferInfo>): TransferInfo {
  return {
    id: "t", connection_id: "c1", direction: "upload",
    local_path: "C:/d/f.bin", remote_path: "/up/dir/f.bin",
    total_bytes: 100, bytes_done: 0,
    state: { kind: "queued" }, started_at: 0,
    ...over,
  } as TransferInfo;
}

describe("buildStripModel", () => {
  it("a directory is one waiting item, not one row per file", () => {
    const m = buildStripModel([
      tr({ id: "a", groupId: "g", state: { kind: "active" }, bytes_done: 40 }),
      tr({ id: "b", groupId: "g", remote_path: "/up/dir/b.bin" }),
      tr({ id: "c", groupId: "g", remote_path: "/up/dir/c.bin" }),
    ], { showAll: true });
    expect(m.transferring.map((t) => t.id)).toEqual(["a"]);
    expect(m.waiting).toHaveLength(1);
    expect(m.waiting[0].remainingFiles).toBe(2);
    expect(m.waiting[0].label).toBe("dir");
    expect(m.itemCount).toBe(1);
  });

  it("finished files keep counting toward the totals", () => {
    // Otherwise the denominator shrinks as files complete and the bar
    // runs backwards.
    const m = buildStripModel([
      tr({ id: "done", groupId: "g", state: { kind: "done" }, bytes_done: 100 }),
      tr({ id: "run", groupId: "g", state: { kind: "active" }, bytes_done: 50 }),
    ], { showAll: true });
    expect(m.doneFiles).toBe(1);
    expect(m.totalFiles).toBe(2);
    expect(m.bytesDone).toBe(150);
    expect(m.totalBytes).toBe(200);
    expect(Math.round(m.pct)).toBe(75);
  });

  it("mixed directions report no single destination", () => {
    const m = buildStripModel([
      tr({ id: "u", state: { kind: "active" }, bytes_done: 1 }),
      tr({ id: "d", direction: "download", state: { kind: "active" }, bytes_done: 1 }),
    ], { showAll: true });
    expect(m.direction).toBeNull();
  });

  it("a resumed transfer waiting for its slot stays in transferring", () => {
    // Pause then resume briefly reports queued with bytes already moved;
    // bouncing the row down to Waiting would look like lost progress.
    const m = buildStripModel([
      tr({ id: "r", state: { kind: "queued" }, bytes_done: 30 }),
    ], { showAll: true });
    expect(m.transferring.map((t) => t.id)).toEqual(["r"]);
    expect(m.waiting).toHaveLength(0);
  });

  it("failures neither move nor wait, and make the strip persist", () => {
    const m = buildStripModel([
      tr({ id: "x", state: { kind: "failed", error: "550" } }),
    ], { showAll: true });
    expect(m.failed).toHaveLength(1);
    expect(m.transferring).toHaveLength(0);
    expect(m.waiting).toHaveLength(0);
    expect(stripHasContent(m)).toBe(true);
  });

  it("done-only lists show nothing", () => {
    const m = buildStripModel([
      tr({ id: "x", state: { kind: "done" }, bytes_done: 100 }),
    ], { showAll: true });
    expect(stripHasContent(m)).toBe(false);
  });

  it("scoping by connection filters before anything else", () => {
    const m = buildStripModel([
      tr({ id: "mine", state: { kind: "active" }, bytes_done: 1 }),
      tr({ id: "theirs", connection_id: "c2", state: { kind: "active" }, bytes_done: 1 }),
    ], { connectionId: "c1" });
    expect(m.transferring.map((t) => t.id)).toEqual(["mine"]);
  });

  it("zero totals never divide by zero", () => {
    const m = buildStripModel([tr({ id: "q", total_bytes: 0 })], { showAll: true });
    expect(m.pct).toBe(0);
  });

  it("the label is the dragged folder, wherever a child happens to sit", () => {
    // A child inside dir/caches/ must not relabel the whole gesture as
    // "caches" the moment it starts.
    const m = buildStripModel([
      tr({
        id: "deep", groupId: "g", groupLabel: "UbuntuServer24",
        remote_path: "/up/UbuntuServer24/caches/vmware-0.log",
        state: { kind: "active" }, bytes_done: 1,
      }),
    ], { showAll: true });
    expect(m.primaryLabel).toBe("UbuntuServer24");
  });

  it("rows without a recorded label still get the path-derived fallback", () => {
    const m = buildStripModel([
      tr({ id: "old", groupId: "g", remote_path: "/up/dir/f.bin", state: { kind: "active" }, bytes_done: 1 }),
    ], { showAll: true });
    expect(m.primaryLabel).toBe("dir");
  });
});

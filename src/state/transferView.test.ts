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
  it("a directory is one gesture row, however many files it brought", () => {
    const m = buildStripModel([
      tr({ id: "a", groupId: "g", groupLabel: "dir", state: { kind: "active" }, bytes_done: 40 }),
      tr({ id: "b", groupId: "g", groupLabel: "dir", remote_path: "/up/dir/b.bin" }),
      tr({ id: "c", groupId: "g", groupLabel: "dir", remote_path: "/up/dir/c.bin" }),
    ], { showAll: true });
    expect(m.gestures).toHaveLength(1);
    expect(m.gestures[0].label).toBe("dir");
    expect(m.gestures[0].totalFiles).toBe(3);
    expect(m.gestures[0].status).toBe("active");
    expect(m.itemCount).toBe(1);
  });

  it("one gesture cannot expand; two can", () => {
    const one = buildStripModel([
      tr({ id: "a", state: { kind: "active" }, bytes_done: 1 }),
    ], { showAll: true });
    expect(one.canExpand).toBe(false);
    const two = buildStripModel([
      tr({ id: "a", state: { kind: "active" }, bytes_done: 1 }),
      tr({ id: "b", remote_path: "/up/dir/b.bin" }),
    ], { showAll: true });
    expect(two.canExpand).toBe(true);
  });

  it("finished files keep counting toward a gesture's totals", () => {
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
    expect(m.gestures[0].doneFiles).toBe(1);
  });

  it("a fully finished gesture leaves the strip and its totals", () => {
    // Lingering done children of a completed drag must not inflate the
    // next drag's counters.
    const m = buildStripModel([
      tr({ id: "old1", groupId: "gone", state: { kind: "done" }, bytes_done: 100 }),
      tr({ id: "old2", groupId: "gone", state: { kind: "done" }, bytes_done: 100 }),
      tr({ id: "new", state: { kind: "active" }, bytes_done: 10 }),
    ], { showAll: true });
    expect(m.gestures).toHaveLength(1);
    expect(m.totalFiles).toBe(1);
    expect(m.totalBytes).toBe(100);
  });

  it("mixed directions report no single destination", () => {
    const m = buildStripModel([
      tr({ id: "u", state: { kind: "active" }, bytes_done: 1 }),
      tr({ id: "d", direction: "download", state: { kind: "active" }, bytes_done: 1 }),
    ], { showAll: true });
    expect(m.direction).toBeNull();
  });

  it("a gesture with only queued members reads as queued", () => {
    const m = buildStripModel([
      tr({ id: "q1", groupId: "g" }),
      tr({ id: "q2", groupId: "g", remote_path: "/up/dir/b.bin" }),
    ], { showAll: true });
    expect(m.gestures[0].status).toBe("queued");
  });

  it("a fully failed gesture turns into one red row with the dominant error", () => {
    const m = buildStripModel([
      tr({ id: "x", groupId: "g", state: { kind: "failed", error: "550" } }),
      tr({ id: "y", groupId: "g", state: { kind: "failed", error: "550" } }),
      tr({ id: "z", groupId: "g", state: { kind: "failed", error: "denied" } }),
    ], { showAll: true });
    expect(m.gestures).toHaveLength(1);
    expect(m.gestures[0].status).toBe("failed");
    expect(m.gestures[0].failedCount).toBe(3);
    expect(m.gestures[0].mainError).toBe("550");
    expect(stripHasContent(m)).toBe(true);
  });

  it("failures inside a still-moving gesture ride along, row stays active", () => {
    const m = buildStripModel([
      tr({ id: "x", groupId: "g", state: { kind: "failed", error: "550" } }),
      tr({ id: "r", groupId: "g", state: { kind: "active" }, bytes_done: 5 }),
    ], { showAll: true });
    expect(m.gestures[0].status).toBe("active");
    expect(m.gestures[0].failedCount).toBe(1);
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
    expect(m.gestures.map((g) => g.key)).toEqual(["mine"]);
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

  it("gesture speed is the sum of its members' last reported rates", () => {
    const m = buildStripModel([
      tr({ id: "a", groupId: "g", state: { kind: "active" }, bytes_done: 1, rateBps: 1000 }),
      tr({ id: "b", groupId: "g", state: { kind: "active" }, bytes_done: 1, rateBps: 500 }),
      tr({ id: "c", groupId: "g", state: { kind: "done" }, bytes_done: 100, rateBps: 9999 }),
    ], { showAll: true });
    expect(m.gestures[0].rateBps).toBe(1500);
  });
});

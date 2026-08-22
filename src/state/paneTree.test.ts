import { describe, it, expect } from "vitest";
import {
  leaf, paneIds, paneCount, hasPane, splitPane, wrapRoot, dropPane,
  swapPanes, replacePane, equalizeAll, equalizePath, setBoundary, normalize,
  nodeAtPath, type PaneNode,
} from "./paneTree";

/** Compact shape for assertions: "(v a b)" is a row of a and b. */
function shape(node: PaneNode | null): string {
  if (!node) return "-";
  if (node.kind === "leaf") return node.sessionId;
  return `(${node.dir} ${node.kids.map(shape).join(" ")})`;
}

function pct(node: PaneNode | null, path = ""): string {
  const at = nodeAtPath(node, path);
  if (!at || at.kind !== "split") return "";
  return at.ratios.map((r) => Math.round(r * 100)).join("/");
}

describe("paneTree", () => {
  it("splits a lone pane into two halves", () => {
    const t = splitPane(leaf("a"), "a", "right", "b");
    expect(shape(t)).toBe("(v a b)");
    expect(pct(t)).toBe("50/50");
  });

  it("keeps a row even as it grows, instead of halving one cell", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "b", "right", "c");
    t = splitPane(t, "c", "right", "d");
    // The whole point of the n-ary shape: four equal columns, not
    // 1/2 + 1/4 + 1/8 + 1/8.
    expect(shape(t)).toBe("(v a b c d)");
    expect(pct(t)).toBe("25/25/25/25");
  });

  it("respects the side the drop landed on", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "a", "left", "z");
    expect(shape(t)).toBe("(v z a b)");
  });

  it("nests only when the direction changes", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "b", "bottom", "c");
    expect(shape(t)).toBe("(v a (h b c))");
    // The outer row is untouched by the inner split.
    expect(pct(t)).toBe("50/50");
    expect(pct(t, "1")).toBe("50/50");
  });

  it("wraps the whole layout when dropped on the outside", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = wrapRoot(t, "bottom", "log");
    // log spans the full width beneath both columns.
    expect(shape(t)).toBe("(h (v a b) log)");
    expect(pct(t)).toBe("50/50");
  });

  it("joins the outermost row rather than wrapping it twice", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = wrapRoot(t, "bottom", "log");
    t = wrapRoot(t, "top", "top");
    expect(shape(t)).toBe("(h top (v a b) log)");
    expect(pct(t)).toBe("33/33/33");
  });

  it("a pane-level bottom split only touches that column", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "b", "right", "c");
    t = wrapRoot(t, "bottom", "log");
    t = splitPane(t, "b", "bottom", "e");
    expect(shape(t)).toBe("(h (v a (h b e) c) log)");
  });

  it("hands a removed pane's space to its siblings in proportion", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "b", "right", "c");
    t = setBoundary(t, "", 0, 0.8); // a grows, b shrinks
    const before = pct(t);
    t = dropPane(t, "c") as PaneNode;
    expect(shape(t)).toBe("(v a b)");
    // c's third is shared out, so a is still the wide one.
    const after = pct(t).split("/").map(Number);
    expect(after[0]).toBeGreaterThan(after[1]);
    expect(after[0] + after[1]).toBe(100);
    expect(before).not.toBe(pct(t));
  });

  it("collapses a split left with a single child", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "b", "bottom", "c");
    expect(shape(t)).toBe("(v a (h b c))");
    t = dropPane(t, "c") as PaneNode;
    expect(shape(t)).toBe("(v a b)");
  });

  it("returns null once the last pane leaves", () => {
    let t: PaneNode | null = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = dropPane(t, "a");
    expect(shape(t)).toBe("b");
    t = dropPane(t, "b");
    expect(t).toBeNull();
  });

  it("removes a deeply nested pane", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "b", "bottom", "c");
    t = splitPane(t, "c", "right", "d");
    expect(shape(t)).toBe("(v a (h b (v c d)))");
    t = dropPane(t, "d") as PaneNode;
    expect(shape(t)).toBe("(v a (h b c))");
  });

  it("swaps two panes without moving the boxes", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "b", "bottom", "c");
    const swapped = swapPanes(t, "a", "c");
    expect(shape(swapped)).toBe("(v c (h b a))");
    expect(pct(swapped)).toBe(pct(t));
  });

  it("replaces the session a pane points at", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    const t2 = replacePane(t, "b", "z");
    expect(shape(t2)).toBe("(v a z)");
    expect(hasPane(t2, "b")).toBe(false);
  });

  it("levels one row or every row", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "b", "bottom", "c");
    t = setBoundary(t, "", 0, 0.75);
    t = setBoundary(t, "1", 0, 0.8);
    expect(pct(t)).toBe("75/25");
    t = equalizePath(t, "1");
    expect(pct(t, "1")).toBe("50/50");
    expect(pct(t)).toBe("75/25");
    t = equalizeAll(t);
    expect(pct(t)).toBe("50/50");
  });

  it("clamps a boundary drag and leaves other panes alone", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "b", "right", "c");
    t = setBoundary(t, "", 0, 0.99);
    const r = pct(t).split("/").map(Number);
    // First pair clamps at 88/12 of its combined two-thirds; the third
    // column keeps its own third.
    expect(r[2]).toBe(33);
    expect(r[0]).toBeGreaterThan(r[1]);
  });

  it("treats a one-pane layout as no layout at all", () => {
    expect(normalize(leaf("a"))).toBeNull();
    expect(paneCount(normalize(splitPane(leaf("a"), "a", "right", "b")))).toBe(2);
  });

  it("reports ids in visual order", () => {
    let t: PaneNode = leaf("a");
    t = splitPane(t, "a", "right", "b");
    t = splitPane(t, "a", "bottom", "c");
    expect(paneIds(t)).toEqual(["a", "c", "b"]);
  });

  it("ignores operations aimed at a pane that isn't shown", () => {
    const t = splitPane(leaf("a"), "a", "right", "b");
    expect(shape(splitPane(t, "ghost", "right", "x"))).toBe(shape(t));
    expect(shape(dropPane(t, "ghost"))).toBe(shape(t));
  });
});

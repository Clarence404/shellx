import { describe, it, expect } from "vitest";
import {
  EMPTY, clickRow, contextRow, isSelecting, prune, selectAll,
  type Selection,
} from "./hostSelection";

const IDS = ["a", "b", "c", "d", "e"];
const plain = { ctrl: false, shift: false };
const ctrl = { ctrl: true, shift: false };
const shift = { ctrl: false, shift: true };

function sel(ids: string[], anchor: number | null = null): Selection {
  return { ids, anchor };
}

describe("host selection", () => {
  it("a plain click on a quiet drawer still connects", () => {
    const out = clickRow(EMPTY, 2, IDS, plain);
    expect(out.kind).toBe("connect");
    expect(out.kind === "connect" && out.id).toBe("c");
    expect(out.selection.ids).toEqual([]);
    // The row is remembered as the anchor even though nothing is
    // selected, so a following Shift click has something to span from.
    expect(out.selection.anchor).toBe(2);
  });

  it("ctrl-click picks a row without connecting", () => {
    const out = clickRow(EMPTY, 1, IDS, ctrl);
    expect(out.kind).toBe("select");
    expect(out.selection.ids).toEqual(["b"]);
    expect(out.selection.anchor).toBe(1);
  });

  it("ctrl-click again lets go of that row", () => {
    const out = clickRow(sel(["b", "d"], 3), 1, IDS, ctrl);
    expect(out.selection.ids).toEqual(["d"]);
  });

  it("shift-click spans from the anchor", () => {
    const out = clickRow(sel(["b"], 1), 3, IDS, shift);
    expect(out.selection.ids).toEqual(["b", "c", "d"]);
  });

  it("spans upwards just as well", () => {
    const out = clickRow(sel(["d"], 3), 1, IDS, shift);
    expect(out.selection.ids.sort()).toEqual(["b", "c", "d"]);
  });

  it("keeps the anchor so the far end can be dragged back", () => {
    const first = clickRow(sel(["b"], 1), 4, IDS, shift).selection;
    expect(first.anchor).toBe(1);
    const back = clickRow(first, 2, IDS, shift).selection;
    // Still pivoting on b, not on the row picked a moment ago.
    expect(back.anchor).toBe(1);
    expect(back.ids).toContain("b");
    expect(back.ids).toContain("c");
  });

  it("shift with nothing to pivot on just picks the row", () => {
    const out = clickRow(EMPTY, 2, IDS, shift);
    expect(out.kind).toBe("select");
    expect(out.selection.ids).toEqual(["c"]);
    expect(out.selection.anchor).toBe(2);
  });

  it("a plain click during a selection re-picks instead of connecting", () => {
    // The whole point: hands are full of selected rows, so an unmodified
    // click is a correction, not a request to open a shell.
    const out = clickRow(sel(["a", "b"], 1), 4, IDS, plain);
    expect(out.kind).toBe("select");
    expect(out.selection.ids).toEqual(["e"]);
  });

  it("right-clicking a selected row keeps the whole selection", () => {
    const out = contextRow(sel(["a", "b", "c"], 0), 1, IDS);
    expect(out.menu).toBe("bulk");
    expect(out.selection.ids).toEqual(["a", "b", "c"]);
  });

  it("right-clicking elsewhere drops the selection first", () => {
    // Otherwise "picked three, right-clicked a fourth, deleted the
    // three" is one slip away.
    const out = contextRow(sel(["a", "b", "c"], 0), 4, IDS);
    expect(out.menu).toBe("single");
    expect(out.selection.ids).toEqual([]);
  });

  it("one selected row gets the ordinary menu, not the bulk one", () => {
    const out = contextRow(sel(["b"], 1), 1, IDS);
    expect(out.menu).toBe("single");
  });

  it("select all takes every row", () => {
    expect(selectAll(IDS).ids).toEqual(IDS);
    expect(selectAll([])).toEqual(EMPTY);
  });

  it("prune forgets rows that are gone", () => {
    expect(prune(sel(["a", "z"], 0), IDS).ids).toEqual(["a"]);
    expect(prune(sel(["y", "z"], 0), IDS)).toEqual(EMPTY);
    // Untouched selections keep their identity so React can skip work.
    const same = sel(["a", "b"], 0);
    expect(prune(same, IDS)).toBe(same);
  });

  it("isSelecting is what the drawer switches its footer on", () => {
    expect(isSelecting(EMPTY)).toBe(false);
    expect(isSelecting(sel(["a"]))).toBe(true);
  });
});

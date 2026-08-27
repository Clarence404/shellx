/**
 * Which host rows are selected, and what a click means.
 *
 * Multi-select is additive, not a mode: with nothing selected the drawer
 * behaves exactly as it always has, and a plain click still connects.
 * The one place that changes is a plain click *while a selection is
 * live* — there, the click almost certainly means "change what I have
 * picked", not "connect to this one", so it collapses the selection onto
 * the clicked row instead. Press Escape and the drawer is back to normal.
 */

export interface Selection {
  /** Host ids, in no particular order. */
  ids: string[];
  /** Index of the last row picked outright — where a Shift range starts. */
  anchor: number | null;
}

export const EMPTY: Selection = { ids: [], anchor: null };

export interface Modifiers {
  ctrl: boolean;
  shift: boolean;
}

export type ClickOutcome =
  /** Nothing was selected and none is now: this was an ordinary click. */
  | { kind: "connect"; id: string; selection: Selection }
  | { kind: "select"; selection: Selection };

export function isSelecting(sel: Selection): boolean {
  return sel.ids.length > 0;
}

export function clickRow(
  sel: Selection,
  index: number,
  ids: string[],
  mods: Modifiers,
): ClickOutcome {
  const id = ids[index];
  if (id === undefined) return { kind: "select", selection: sel };

  if (mods.shift) {
    // Without an anchor there is no range to draw, so the click picks
    // just this row and becomes the anchor for the next one.
    if (sel.anchor === null) {
      return { kind: "select", selection: { ids: [id], anchor: index } };
    }
    const [from, to] = sel.anchor <= index ? [sel.anchor, index] : [index, sel.anchor];
    const range = ids.slice(from, to + 1);
    // The anchor stays put: dragging the far end of a Shift range back
    // and forth should keep pivoting on the same row.
    return {
      kind: "select",
      selection: { ids: [...new Set([...sel.ids, ...range])], anchor: sel.anchor },
    };
  }

  if (mods.ctrl) {
    const has = sel.ids.includes(id);
    return {
      kind: "select",
      selection: {
        ids: has ? sel.ids.filter((x) => x !== id) : [...sel.ids, id],
        anchor: index,
      },
    };
  }

  if (isSelecting(sel)) {
    return { kind: "select", selection: { ids: [id], anchor: index } };
  }

  // The anchor is remembered even here, so a plain click followed by a
  // Shift click selects the span between them.
  return { kind: "connect", id, selection: { ids: [], anchor: index } };
}

/**
 * What a right-click should do before the menu opens. Right-clicking a
 * row that is not part of the selection drops the selection first —
 * otherwise "I picked three, right-clicked a fourth, deleted the three"
 * is one slip away.
 */
export function contextRow(
  sel: Selection,
  index: number,
  ids: string[],
): { menu: "single" | "bulk"; selection: Selection } {
  const id = ids[index];
  if (id !== undefined && sel.ids.includes(id) && sel.ids.length > 1) {
    return { menu: "bulk", selection: sel };
  }
  return { menu: "single", selection: { ids: [], anchor: index } };
}

export function selectAll(ids: string[]): Selection {
  return { ids: [...ids], anchor: ids.length ? 0 : null };
}

/** Drops ids that are no longer in the list — after a delete, say. */
export function prune(sel: Selection, ids: string[]): Selection {
  const kept = sel.ids.filter((id) => ids.includes(id));
  if (kept.length === sel.ids.length) return sel;
  return kept.length ? { ids: kept, anchor: sel.anchor } : EMPTY;
}

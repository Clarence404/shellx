import { create } from "zustand";
import type { DropZone } from "./paneTree";

/**
 * Live state of a pane drag. Shared in a store because the drag can start
 * in the titlebar (a tab) and end in the main area (a pane), which are far
 * apart in the tree.
 *
 * `armed` is the pointer-down-but-not-yet-moved phase: a plain click on a
 * tab or a pane header must stay a click, so nothing is treated as a drag
 * until the pointer travels past DRAG_THRESHOLD.
 */

/** px of travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;

/** Which layer the pointer is over. "root" = the outer band of the whole
 *  area, where a drop spans everything instead of splitting one pane. */
export type DragScope = "pane" | "root";

export interface DragTarget {
  scope: DragScope;
  /** Pane the pointer is over. Null for a root-scope drop. */
  paneId: string | null;
  zone: DropZone;
}

interface PaneDragState {
  /** Session being dragged, or null when nothing is happening. */
  sessionId: string | null;
  armed: boolean;
  origin: { x: number; y: number };
  pointer: { x: number; y: number };
  target: DragTarget | null;

  arm: (sessionId: string, x: number, y: number) => void;
  /** Returns true once the press has travelled far enough to be a drag. */
  move: (x: number, y: number) => boolean;
  setTarget: (target: DragTarget | null) => void;
  end: () => void;
}

export const usePaneDrag = create<PaneDragState>((set, get) => ({
  sessionId: null,
  armed: false,
  origin: { x: 0, y: 0 },
  pointer: { x: 0, y: 0 },
  target: null,

  arm: (sessionId, x, y) =>
    set({ sessionId, armed: true, origin: { x, y }, pointer: { x, y }, target: null }),

  move: (x, y) => {
    const st = get();
    if (!st.sessionId) return false;
    const far = Math.abs(x - st.origin.x) >= DRAG_THRESHOLD
      || Math.abs(y - st.origin.y) >= DRAG_THRESHOLD;
    if (st.armed && !far) return false;
    if (st.armed) set({ armed: false, pointer: { x, y } });
    else set({ pointer: { x, y } });
    return true;
  },

  setTarget: (target) => set({ target }),

  end: () => set({ sessionId: null, armed: false, target: null }),
}));

/** True while a drag is actually under way (armed presses don't count). */
export function isDragging(st: PaneDragState): boolean {
  return st.sessionId !== null && !st.armed;
}

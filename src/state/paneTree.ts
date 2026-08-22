/**
 * The pane layout is an n-ary tree of splits over sessions. Every function
 * here is pure: it takes a tree and returns a new one, so the store can
 * treat layout changes like any other state update and the tests below
 * don't need React or a DOM.
 *
 * Why n-ary rather than the usual binary tree: splitting a pane a second
 * time in the same direction should give three EQUAL columns, not
 * 1/2 + 1/4 + 1/4. A same-direction split therefore joins the existing
 * row instead of nesting inside one of its cells, and the row's ratios are
 * levelled. Nesting only happens when the direction changes.
 */

export type PaneDir = "v" | "h";

export type PaneNode =
  | { kind: "leaf"; sessionId: string }
  | { kind: "split"; dir: PaneDir; ratios: number[]; kids: PaneNode[] };

/** Where a drop landed, relative to the pane (or the whole area) under it. */
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export function leaf(sessionId: string): PaneNode {
  return { kind: "leaf", sessionId };
}

export function dirOf(zone: Exclude<DropZone, "center">): PaneDir {
  return zone === "left" || zone === "right" ? "v" : "h";
}

function isFirst(zone: Exclude<DropZone, "center">): boolean {
  return zone === "left" || zone === "top";
}

function evenRatios(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

function clone(node: PaneNode): PaneNode {
  return node.kind === "leaf"
    ? { kind: "leaf", sessionId: node.sessionId }
    : { kind: "split", dir: node.dir, ratios: [...node.ratios], kids: node.kids.map(clone) };
}

/** Session ids in visual order, left-to-right then top-to-bottom. */
export function paneIds(node: PaneNode | null): string[] {
  if (!node) return [];
  if (node.kind === "leaf") return [node.sessionId];
  return node.kids.flatMap(paneIds);
}

export function paneCount(node: PaneNode | null): number {
  return paneIds(node).length;
}

export function hasPane(node: PaneNode | null, sessionId: string): boolean {
  return paneIds(node).includes(sessionId);
}

/** Resolve a dotted child path ("0.1") to its node, or null if it's gone. */
export function nodeAtPath(root: PaneNode | null, path: string): PaneNode | null {
  if (!root) return null;
  if (path === "") return root;
  let node: PaneNode = root;
  for (const step of path.split(".")) {
    if (node.kind !== "split") return null;
    const next = node.kids[Number(step)];
    if (!next) return null;
    node = next;
  }
  return node;
}

type Found = { parent: Extract<PaneNode, { kind: "split" }> | null; index: number };

function find(root: PaneNode, sessionId: string): Found | null {
  if (root.kind === "leaf") return root.sessionId === sessionId ? { parent: null, index: -1 } : null;
  for (let i = 0; i < root.kids.length; i++) {
    const kid = root.kids[i];
    if (kid.kind === "leaf" && kid.sessionId === sessionId) return { parent: root, index: i };
    const deeper = find(kid, sessionId);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * Split the pane showing `targetId`, putting `newId` on the given side.
 * A split in the direction the target's row already runs joins that row
 * and levels it out; otherwise the target cell becomes a nested split.
 */
export function splitPane(
  root: PaneNode,
  targetId: string,
  zone: Exclude<DropZone, "center">,
  newId: string,
): PaneNode {
  const next = clone(root);
  const hit = find(next, targetId);
  if (!hit) return root;
  const dir = dirOf(zone);
  const fresh = leaf(newId);

  if (hit.parent && hit.parent.dir === dir) {
    const at = isFirst(zone) ? hit.index : hit.index + 1;
    hit.parent.kids.splice(at, 0, fresh);
    hit.parent.ratios = evenRatios(hit.parent.kids.length);
    return next;
  }

  const cell = hit.parent ? hit.parent.kids[hit.index] : next;
  const kids = isFirst(zone) ? [fresh, cell] : [cell, fresh];
  const nested: PaneNode = { kind: "split", dir, ratios: evenRatios(2), kids };
  if (!hit.parent) return nested;
  hit.parent.kids[hit.index] = nested;
  return next;
}

/**
 * Put a pane at the very outside: a full-width row above or below
 * everything, or a full-height column beside it. When the outermost split
 * already runs that way the pane joins it (and the row is levelled) rather
 * than wrapping the whole layout in another layer.
 */
export function wrapRoot(
  root: PaneNode | null,
  zone: Exclude<DropZone, "center">,
  newId: string,
): PaneNode {
  const fresh = leaf(newId);
  if (!root) return fresh;
  const dir = dirOf(zone);
  const next = clone(root);
  if (next.kind === "split" && next.dir === dir) {
    next.kids.splice(isFirst(zone) ? 0 : next.kids.length, 0, fresh);
    next.ratios = evenRatios(next.kids.length);
    return next;
  }
  return {
    kind: "split", dir, ratios: evenRatios(2),
    kids: isFirst(zone) ? [fresh, next] : [next, fresh],
  };
}

/**
 * Remove a pane. Its share goes to the surviving siblings in proportion,
 * so a ratio the user dragged by hand isn't thrown away just because a
 * neighbour left. A split left with one child collapses into it. Returns
 * null when the layout is emptied.
 */
export function dropPane(root: PaneNode | null, sessionId: string): PaneNode | null {
  if (!root) return null;
  if (root.kind === "leaf") return root.sessionId === sessionId ? null : root;

  const next = clone(root) as Extract<PaneNode, { kind: "split" }>;
  const shrink = (split: Extract<PaneNode, { kind: "split" }>): PaneNode | null => {
    for (let i = 0; i < split.kids.length; i++) {
      const kid = split.kids[i];
      if (kid.kind === "leaf" && kid.sessionId === sessionId) {
        const freed = split.ratios[i];
        split.kids.splice(i, 1);
        split.ratios.splice(i, 1);
        const sum = split.ratios.reduce((a, b) => a + b, 0) || 1;
        split.ratios = split.ratios.map((r) => r + freed * (r / sum));
        return split.kids.length === 1 ? split.kids[0] : split;
      }
      if (kid.kind === "split") {
        const replaced = shrink(kid);
        if (replaced !== kid) {
          if (replaced === null) {
            split.kids.splice(i, 1);
            split.ratios.splice(i, 1);
            return split.kids.length === 1 ? split.kids[0] : split;
          }
          split.kids[i] = replaced;
          return split;
        }
      }
    }
    return split;
  };
  const out = shrink(next);
  return out;
}

/** Swap the two panes' sessions, keeping every box exactly where it is. */
export function swapPanes(root: PaneNode, a: string, b: string): PaneNode {
  if (a === b) return root;
  const next = clone(root);
  const walk = (node: PaneNode) => {
    if (node.kind === "leaf") {
      if (node.sessionId === a) node.sessionId = b;
      else if (node.sessionId === b) node.sessionId = a;
      return;
    }
    node.kids.forEach(walk);
  };
  walk(next);
  return next;
}

/** Point an existing pane at a different session. */
export function replacePane(root: PaneNode, targetId: string, sessionId: string): PaneNode {
  const next = clone(root);
  const walk = (node: PaneNode) => {
    if (node.kind === "leaf") {
      if (node.sessionId === targetId) node.sessionId = sessionId;
      return;
    }
    node.kids.forEach(walk);
  };
  walk(next);
  return next;
}

/** Level out one row/column (the split at `path`). */
export function equalizePath(root: PaneNode, path: string): PaneNode {
  const next = clone(root);
  const node = nodeAtPath(next, path);
  if (!node || node.kind !== "split") return root;
  node.ratios = evenRatios(node.kids.length);
  return next;
}

/** Level out every row and column. */
export function equalizeAll(root: PaneNode): PaneNode {
  const next = clone(root);
  const walk = (node: PaneNode) => {
    if (node.kind === "leaf") return;
    node.ratios = evenRatios(node.kids.length);
    node.kids.forEach(walk);
  };
  walk(next);
  return next;
}

/**
 * Move one boundary inside a row: the pair on either side of gutter
 * `index` trade space, everything else holds still. `fraction` is where
 * the boundary should sit within that pair, 0..1.
 */
export function setBoundary(
  root: PaneNode,
  path: string,
  index: number,
  fraction: number,
): PaneNode {
  const next = clone(root);
  const node = nodeAtPath(next, path);
  if (!node || node.kind !== "split") return root;
  const a = node.ratios[index];
  const b = node.ratios[index + 1];
  if (a === undefined || b === undefined) return root;
  const total = a + b;
  const f = Math.max(0.12, Math.min(0.88, fraction));
  node.ratios[index] = total * f;
  node.ratios[index + 1] = total * (1 - f);
  return next;
}

/** Layouts of one pane are pointless — the caller shows that session plain. */
export function normalize(root: PaneNode | null): PaneNode | null {
  if (!root) return null;
  return paneCount(root) > 1 ? root : null;
}

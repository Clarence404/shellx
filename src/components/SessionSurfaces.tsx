import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * One stable DOM node per session, into which that session's body is
 * portalled — and which the pane layout moves around with `appendChild`.
 *
 * This exists for xterm. A terminal's scrollback and its connection live
 * in the Terminal instance attached to a DOM element; if React remounts
 * TerminalView the instance is disposed and the scrollback goes with it.
 * Rendering the body inside the pane tree would do exactly that on every
 * layout change, because a node moving to a different parent unmounts and
 * remounts. So the body renders into a host div that React owns and never
 * relocates, while the layout relocates the host div itself — a move React
 * neither sees nor cares about. Detaching the host (a pane closing) is
 * harmless: the element stays valid and the next layout pass re-attaches
 * it, which is also how a session parked out of the layout keeps running.
 */

const hosts = new Map<string, HTMLDivElement>();

export function surfaceHost(sessionId: string): HTMLDivElement {
  let el = hosts.get(sessionId);
  if (!el) {
    el = document.createElement("div");
    el.dataset.surface = sessionId;
    el.style.height = "100%";
    el.style.minHeight = "0";
    el.style.position = "relative";
    // Clip, like the absolutely-positioned box this replaced. Without it a
    // terminal whose fit briefly computed one row too many paints past the
    // pane and gets cut by an ancestor instead — and since overflow doesn't
    // resize anything, no ResizeObserver tick ever corrects it.
    el.style.overflow = "hidden";
    hosts.set(sessionId, el);
  }
  return el;
}

export function disposeSurfaceHost(sessionId: string): void {
  const el = hosts.get(sessionId);
  if (el && el.parentNode) el.parentNode.removeChild(el);
  hosts.delete(sessionId);
}

/** Attach each session's host div into the slot the layout gave it, and
 *  park the rest in `park` so their terminals keep running off-screen. */
export function placeSurfaces(
  slots: Map<string, HTMLElement>,
  sessionIds: string[],
  park: HTMLElement | null,
): void {
  // Bury the dead first. A removed session's host div used to stay
  // wherever it was — and when that was a pane slot, the next session
  // moved in BEHIND the full-height corpse and the pane showed white.
  const alive = new Set(sessionIds);
  for (const [id, el] of hosts) {
    if (!alive.has(id)) {
      el.parentNode?.removeChild(el);
      hosts.delete(id);
    }
  }
  const moved: string[] = [];
  for (const id of sessionIds) {
    const host = surfaceHost(id);
    const slot = slots.get(id) ?? park;
    if (slot && host.parentNode !== slot) {
      slot.appendChild(host);
      moved.push(id);
    }
  }
  // A move can change the box a terminal has to live in without changing
  // its pixel size (parked → shown at the same dimensions, or shifted
  // between equally sized panes), and then no ResizeObserver fires. Ask
  // the view to re-fit once layout has settled.
  if (moved.length > 0) {
    requestAnimationFrame(() => {
      for (const id of moved) {
        window.dispatchEvent(new CustomEvent("shellx:refit", { detail: id }));
      }
    });
  }
}

export function SessionSurfaces({
  sessionIds, renderBody,
}: {
  sessionIds: string[];
  renderBody: (sessionId: string) => ReactNode;
}) {
  return (
    <>
      {sessionIds.map((id) => createPortal(renderBody(id), surfaceHost(id), id))}
    </>
  );
}

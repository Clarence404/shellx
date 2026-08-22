import { useSessions } from "../state/sessions";

/**
 * Room the floating activity switcher needs in a pane's top-right corner.
 *
 * Unsplit, the switcher hovers over the body's top-right rather than
 * owning a toolbar row. Views that put their own controls in that same
 * corner — the file browser's folder/refresh/upload buttons, the tunnel
 * panel's header — reserve this much so the two don't stack. Split, the
 * switcher lives in each pane's header instead and the gutter is zero.
 */
export const FLOATING_SWITCHER_GUTTER = 78;

export function useTopRightGutter(): number {
  const split = useSessions((s) => s.layout !== null);
  return split ? 0 : FLOATING_SWITCHER_GUTTER;
}

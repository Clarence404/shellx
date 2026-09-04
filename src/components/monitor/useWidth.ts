import { useEffect, useRef, useState } from "react";

/** Width tier for the monitor chrome, measured on the panel itself (not the
 *  window) — the left drawer opening/closing changes available width, so
 *  the panel's own box is the honest signal. */
export type WidthTier = "narrow" | "medium" | "wide";

export function tierOf(w: number): WidthTier {
  if (w < 560) return "narrow";
  if (w < 720) return "medium";
  return "wide";
}

/** Returns [ref, tier]; attach ref to the element whose width should drive
 *  the layout. Falls back to "wide" until first measured. */
export function useWidthTier<T extends HTMLElement>(): [React.RefObject<T>, WidthTier] {
  const ref = useRef<T>(null!);
  const [tier, setTier] = useState<WidthTier>("wide");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setTier((prev) => {
        const next = tierOf(w);
        return next === prev ? prev : next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, tier];
}

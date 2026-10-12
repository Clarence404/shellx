import { create } from "zustand";
import type { Alert } from "../types/alerts";

/** How long a toast stays before it fades on its own. Alerts also live
 *  in the monitor's Alerts tab, so the toast is a nudge, not the record. */
export const TOAST_MS = 8000;

/** At most this many on screen; older ones are pushed off the bottom. */
const MAX_TOASTS = 3;

export interface Toast {
  /** Unique per showing — the same alert firing again gets a new one. */
  key: string;
  alert: Alert;
  /** The connection's display name, resolved when the toast is raised:
   *  the session may be gone by the time it is rendered. */
  hostLabel: string;
}

interface ToastState {
  toasts: Toast[];
  show(alert: Alert, hostLabel: string): void;
  dismiss(key: string): void;
  dismissAll(): void;
}

let seq = 0;

export const useAlertToasts = create<ToastState>((set) => ({
  toasts: [],
  show(alert, hostLabel) {
    const key = `${alert.id}#${seq++}`;
    set((s) => ({ toasts: [...s.toasts, { key, alert, hostLabel }].slice(-MAX_TOASTS) }));
  },
  dismiss(key) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.key !== key) }));
  },
  dismissAll() {
    set({ toasts: [] });
  },
}));

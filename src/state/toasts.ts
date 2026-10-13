import { create } from "zustand";

/** How long a toast stays before it fades on its own. */
export const TOAST_MS = 8000;

/** Confirmations are read at a glance and then they are in the way. */
export const SHORT_TOAST_MS = 3000;

/** At most this many on screen; older ones are pushed off the top. */
const MAX_TOASTS = 3;

export type ToastTone = "info" | "warn" | "error";

export interface Toast {
  /** Unique per showing — the same event twice gets two toasts. */
  key: string;
  title: string;
  body?: string;
  tone: ToastTone;
  /** Render the body in the mono font — it is a command or an address,
   *  not prose. */
  mono?: boolean;
  /** Milliseconds on screen. */
  ttl: number;
}

export interface ToastInput {
  title: string;
  body?: string;
  tone?: ToastTone;
  mono?: boolean;
  ttl?: number;
}

interface ToastState {
  toasts: Toast[];
  show(input: ToastInput): void;
  dismiss(key: string): void;
  dismissAll(): void;
}

let seq = 0;

/**
 * One toast stack for the whole app, bottom-right.
 *
 * Everything transient goes through here — alerts, copy confirmations —
 * so two of them can never render over each other in the same corner.
 */
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  show({ title, body, tone = "info", mono, ttl = TOAST_MS }) {
    const toast: Toast = { key: `t${seq++}`, title, body, tone, mono, ttl };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }));
  },
  dismiss(key) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.key !== key) }));
  },
  dismissAll() {
    set({ toasts: [] });
  },
}));

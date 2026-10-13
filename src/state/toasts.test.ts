import { describe, it, expect, beforeEach } from "vitest";
import { useToasts, TOAST_MS, SHORT_TOAST_MS } from "./toasts";

beforeEach(() => useToasts.setState({ toasts: [] }));

describe("the toast stack", () => {
  it("starts empty, so nothing covers the corner until something happens", () => {
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it("defaults to an informational toast that stays the full time", () => {
    useToasts.getState().show({ title: "Saved" });
    const [t] = useToasts.getState().toasts;
    expect(t.tone).toBe("info");
    expect(t.ttl).toBe(TOAST_MS);
    expect(t.body).toBeUndefined();
  });

  it("carries a body, a tone and the mono flag through", () => {
    useToasts.getState().show({ title: "Copied", body: "ssh -N -L …", tone: "warn", mono: true, ttl: SHORT_TOAST_MS });
    const [t] = useToasts.getState().toasts;
    expect(t).toMatchObject({ title: "Copied", body: "ssh -N -L …", tone: "warn", mono: true, ttl: SHORT_TOAST_MS });
  });

  it("gives the same message twice two separate toasts", () => {
    useToasts.getState().show({ title: "Copied" });
    useToasts.getState().show({ title: "Copied" });
    const [a, b] = useToasts.getState().toasts;
    expect(a.key).not.toBe(b.key);
  });

  it("keeps the newest three and drops what fell off the top", () => {
    for (const title of ["1", "2", "3", "4"]) useToasts.getState().show({ title });
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(["2", "3", "4"]);
  });

  it("dismisses one by key and leaves the rest", () => {
    useToasts.getState().show({ title: "a" });
    useToasts.getState().show({ title: "b" });
    const [first] = useToasts.getState().toasts;
    useToasts.getState().dismiss(first.key);
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(["b"]);
  });

  it("ignores a dismiss for a toast that already went", () => {
    useToasts.getState().show({ title: "a" });
    useToasts.getState().dismiss("gone");
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it("clears the lot", () => {
    useToasts.getState().show({ title: "a" });
    useToasts.getState().show({ title: "b" });
    useToasts.getState().dismissAll();
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it("confirmations go sooner than alerts", () => {
    expect(SHORT_TOAST_MS).toBeLessThan(TOAST_MS);
  });
});

import { describe, it, expect } from "vitest";
import { tunnelRowState, attemptLabel, type TunnelRowInput } from "./tunnelRowState";

function row(over: Partial<TunnelRowInput> = {}) {
  return tunnelRowState({
    status: undefined, hasRetry: false, authFailed: false,
    wasEverActive: false, busy: false, ...over,
  });
}

describe("which button the row offers", () => {
  it("Start, when the rule is simply stopped", () => {
    expect(row().isEngaged).toBe(false);
  });

  it("Stop, while the tunnel is forwarding", () => {
    expect(row({ status: "active" }).isEngaged).toBe(true);
  });

  it("Stop, while a reconnect is armed — the bug this file exists for", () => {
    // Host went away: no active status, a retry waiting on its timer.
    // Offering Start here opened a second attempt beside the loop and
    // left no way to end it.
    const s = row({ status: "error", hasRetry: true, wasEverActive: true });
    expect(s.isReconnecting).toBe(true);
    expect(s.isEngaged).toBe(true);
  });

  it("Stop, while the very first connect is still being retried", () => {
    const s = row({ hasRetry: true, wasEverActive: false });
    expect(s.isFirstConnecting).toBe(true);
    expect(s.isEngaged).toBe(true);
  });

  it("Stop, during the start call itself", () => {
    expect(row({ busy: true }).isEngaged).toBe(true);
  });

  it("Start, once the credentials were refused — nothing is scheduled", () => {
    const s = row({ hasRetry: true, authFailed: true, wasEverActive: true });
    expect(s.isAuthFailed).toBe(true);
    expect(s.isReconnecting).toBe(false);
    expect(s.isEngaged).toBe(false);
  });

  it("Start, after the loop gave up and cleared its retry", () => {
    expect(row({ status: "error", hasRetry: false }).isEngaged).toBe(false);
  });
});

describe("reconnecting vs first-connecting", () => {
  it("a rule that has been up before is reconnecting, not connecting", () => {
    const s = row({ hasRetry: true, wasEverActive: true });
    expect([s.isReconnecting, s.isFirstConnecting]).toEqual([true, false]);
  });

  it("a rule that has never been up is connecting, not reconnecting", () => {
    const s = row({ hasRetry: true, wasEverActive: false });
    expect([s.isReconnecting, s.isFirstConnecting]).toEqual([false, true]);
  });

  it("an active rule is neither", () => {
    const s = row({ status: "active" });
    expect([s.isReconnecting, s.isFirstConnecting]).toEqual([false, false]);
  });

  it("the two are never both set", () => {
    for (const wasEverActive of [true, false]) {
      for (const busy of [true, false]) {
        const s = row({ hasRetry: true, wasEverActive, busy });
        expect(s.isReconnecting && s.isFirstConnecting).toBe(false);
      }
    }
  });
});

describe("status passthrough", () => {
  it("reports the backend's error state for the row's error strip", () => {
    expect(row({ status: "error" }).isError).toBe(true);
    expect(row({ status: "active" }).isError).toBe(false);
  });
});

describe("attemptLabel", () => {
  const t = (k: string) => k;

  it("names the limit so the loop's end is visible", () => {
    expect(attemptLabel(7, 10, t)).toBe("Attempt 7/10");
  });

  it("just counts when the loop never gives up", () => {
    expect(attemptLabel(7, 0, t)).toBe("Attempt 7");
  });

  it("carries no stray # — the Chinese strings wrap the number", () => {
    expect(attemptLabel(3, 10, t)).not.toContain("#");
    expect(attemptLabel(3, 0, t)).not.toContain("#");
  });

  it("translates the word, not the number", () => {
    expect(attemptLabel(2, 5, (k) => (k === "Attempt" ? "第" : k))).toBe("第 2/5");
  });
});

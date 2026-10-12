import { describe, it, expect } from "vitest";
import { desiredIntervals, BACKGROUND_INTERVAL_SECS } from "./monitorBridge";
import type { ConnectionInfo } from "../types/connection";

function conn(id: string, over: Partial<ConnectionInfo> = {}): ConnectionInfo {
  return { id, label: id, kind: "ssh", host_id: null, state: "active", ...over };
}

const NONE = new Map<string, number>();

describe("what gets sampled", () => {
  it("samples nothing when no panel is open and alerts are off", () => {
    expect(desiredIntervals(NONE, [conn("a")], false)).toEqual(new Map());
  });

  it("samples every connected host in the background once alerts are on", () => {
    const got = desiredIntervals(NONE, [conn("a"), conn("b")], true);
    expect([...got]).toEqual([["a", BACKGROUND_INTERVAL_SECS], ["b", BACKGROUND_INTERVAL_SECS]]);
  });

  it("an open panel sets the rate, beating the background one", () => {
    const panels = new Map([["a", 2]]);
    expect(desiredIntervals(panels, [conn("a"), conn("b")], true))
      .toEqual(new Map([["a", 2], ["b", BACKGROUND_INTERVAL_SECS]]));
  });

  it("an open panel samples even with alerts off — that is the monitor itself", () => {
    expect(desiredIntervals(new Map([["a", 5]]), [conn("a")], false)).toEqual(new Map([["a", 5]]));
  });

  it("leaves local shells and serial ports alone — they have no /proc", () => {
    const sessions = [conn("sh", { kind: "local" }), conn("tty", { kind: "serial" }), conn("srv")];
    expect([...desiredIntervals(NONE, sessions, true).keys()]).toEqual(["srv"]);
  });

  it("stops sampling a session that has closed", () => {
    expect(desiredIntervals(NONE, [conn("a", { state: "closed" })], true)).toEqual(new Map());
  });

  it("drops a panel claim for a connection that is gone", () => {
    expect(desiredIntervals(new Map([["ghost", 2]]), [], true)).toEqual(new Map());
  });
});

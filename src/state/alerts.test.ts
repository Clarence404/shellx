import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../ipc/settings", () => ({
  loadSettings: vi.fn().mockResolvedValue(null),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

import { useAlerts, activeAlerts, alertsFor, activeCounts, alertCountByHost } from "./alerts";
import { useSettingsStore } from "./settings";
import { DEFAULT_ALERTS } from "../types/alerts";
import type { MonitorSnapshot } from "../types/monitor";
import type { Alert } from "../types/alerts";

function snap(connectionId: string, cpu: number, disks: Array<[string, number]> = [["/", 10]]): MonitorSnapshot {
  return {
    connectionId, ts: 0,
    cpu: { totalPct: cpu, corePct: [cpu] },
    memory: { totalKb: 1000, usedKb: 100, cachedKb: 0, freeKb: 0, swapTotalKb: 0, swapUsedKb: 0 },
    network: [], processes: [],
    disks: disks.map(([target, usePct]) => ({ target, sizeMb: 100, usedMb: usePct, availMb: 1, usePct })),
    diskIo: { readBytesPerSec: 0, writeBytesPerSec: 0 },
    system: { hostname: "h", os: "", kernel: "", arch: "", uptimeSecs: 1, cpuModel: "", virt: "", hasDocker: false, dockerDenied: false },
    containers: [], containersLoaded: true, failedUnits: [],
    load: { one: 0.1, five: 0, fifteen: 0 },
    sinceBoot: { netRxTotal: 0, netTxTotal: 0, diskReadTotal: 0, diskWriteTotal: 0, cpuAvgPct: 0 },
  };
}

function on(over: Partial<typeof DEFAULT_ALERTS> = {}) {
  useSettingsStore.setState({ alerts: { ...DEFAULT_ALERTS, enabled: true, sustainSamples: 1, ...over } });
}

beforeEach(() => {
  useAlerts.setState({ byConn: {} });
  useSettingsStore.setState({ alerts: DEFAULT_ALERTS });
});

describe("ingest", () => {
  it("records nothing while alerts are switched off", () => {
    const fired = useAlerts.getState().ingest(snap("a", 99));
    expect(fired).toEqual([]);
    expect(useAlerts.getState().byConn).toEqual({});
  });

  it("returns what fired so the caller can notify", () => {
    on();
    const fired = useAlerts.getState().ingest(snap("a", 99));
    expect(fired.map((f) => f.kind)).toEqual(["cpu"]);
  });

  it("keeps each connection's alerts apart", () => {
    on();
    useAlerts.getState().ingest(snap("a", 99));
    useAlerts.getState().ingest(snap("b", 10));
    expect(activeAlerts(useAlerts.getState().byConn, "a")).toHaveLength(1);
    expect(activeAlerts(useAlerts.getState().byConn, "b")).toEqual([]);
  });

  it("carries state across samples, so a breach is not re-reported", () => {
    on({ sustainSamples: 2 });
    expect(useAlerts.getState().ingest(snap("a", 99))).toEqual([]);
    expect(useAlerts.getState().ingest(snap("a", 99))).toHaveLength(1);
    expect(useAlerts.getState().ingest(snap("a", 99))).toEqual([]);
  });

  it("drops everything for a connection once alerts are switched off", () => {
    on();
    useAlerts.getState().ingest(snap("a", 99));
    useSettingsStore.setState({ alerts: DEFAULT_ALERTS });
    useAlerts.getState().ingest(snap("a", 99));
    expect(useAlerts.getState().byConn).toEqual({});
  });

  it("ages out an alert that recovered a while ago", () => {
    on();
    const t0 = 1_000_000;
    useAlerts.getState().ingest(snap("a", 99), t0);
    useAlerts.getState().ingest(snap("a", 10), t0 + 1000);
    expect(useAlerts.getState().byConn.a).toHaveLength(1);
    useAlerts.getState().ingest(snap("a", 10), t0 + 11 * 60_000);
    expect(useAlerts.getState().byConn.a).toEqual([]);
  });

  it("caps a host with a pathological number of breaching mounts", () => {
    on();
    const many: Array<[string, number]> = Array.from({ length: 80 }, (_, i) => [`/m${i}`, 99]);
    useAlerts.getState().ingest(snap("a", 10, many));
    expect(useAlerts.getState().byConn.a).toHaveLength(50);
  });
});

describe("selectors", () => {
  const a = (id: string, clearedAt: number | null, since: number): Alert => ({
    id, connectionId: "c", kind: "cpu", scope: "", severity: "error",
    value: 90, threshold: 85, since, firedAt: since, clearedAt, samples: 1,
  });

  it("lists only what is still firing", () => {
    const byConn = { c: [a("1", null, 1), a("2", 5, 2)] };
    expect(activeAlerts(byConn, "c").map((x) => x.id)).toEqual(["1"]);
  });

  it("puts firing alerts ahead of recovered ones, newest first", () => {
    const byConn = { c: [a("old", 9, 1), a("x", null, 2), a("y", null, 3)] };
    expect(alertsFor(byConn, "c").map((x) => x.id)).toEqual(["y", "x", "old"]);
  });

  it("counts per connection and leaves quiet ones out", () => {
    const byConn = { c: [a("1", null, 1), a("2", null, 2)], d: [a("3", 5, 3)] };
    expect(activeCounts(byConn)).toEqual({ c: 2 });
  });

  it("sums a host's alerts over every session open to it", () => {
    const byConn = { s1: [a("1", null, 1)], s2: [a("2", null, 2), a("3", 9, 3)] };
    const sessions = [
      { id: "s1", label: "", kind: "ssh" as const, host_id: "h1", state: "active" as const },
      { id: "s2", label: "", kind: "ssh" as const, host_id: "h1", state: "active" as const },
    ];
    expect(alertCountByHost(byConn, sessions)).toEqual({ h1: 2 });
  });

  it("badges nothing for a session with no saved host behind it", () => {
    const byConn = { s1: [a("1", null, 1)] };
    const sessions = [{ id: "s1", label: "", kind: "local" as const, host_id: null, state: "active" as const }];
    expect(alertCountByHost(byConn, sessions)).toEqual({});
  });

  it("has nothing to say about a connection it has never seen", () => {
    expect(alertsFor({}, "nope")).toEqual([]);
    expect(activeAlerts({}, "nope")).toEqual([]);
  });
});

describe("clear", () => {
  it("forgets one connection and leaves the rest", () => {
    on();
    useAlerts.getState().ingest(snap("a", 99));
    useAlerts.getState().ingest(snap("b", 99));
    useAlerts.getState().clear("a");
    expect(Object.keys(useAlerts.getState().byConn)).toEqual(["b"]);
  });

  it("clearAll empties everything", () => {
    on();
    useAlerts.getState().ingest(snap("a", 99));
    useAlerts.getState().clearAll();
    expect(useAlerts.getState().byConn).toEqual({});
  });
});

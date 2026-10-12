import { describe, it, expect } from "vitest";
import { evaluate, readings, clearBelow, idOf } from "./alertRules";
import { DEFAULT_ALERTS, type AlertSettings } from "../types/alerts";
import type { MonitorSnapshot, FailedUnit } from "../types/monitor";

const CONN = "c1";

function snap(over: {
  cpu?: number | null; cores?: number;
  usedKb?: number; totalKb?: number; swapUsedKb?: number; swapTotalKb?: number;
  disks?: Array<[string, number]>;
  load?: number | null;
  failed?: string[];
} = {}): MonitorSnapshot {
  const cores = over.cores ?? 4;
  return {
    connectionId: CONN,
    ts: 0,
    cpu: over.cpu === null ? null : { totalPct: over.cpu ?? 10, corePct: Array(cores).fill(over.cpu ?? 10) },
    memory: {
      totalKb: over.totalKb ?? 1000, usedKb: over.usedKb ?? 100, cachedKb: 0, freeKb: 0,
      swapTotalKb: over.swapTotalKb ?? 0, swapUsedKb: over.swapUsedKb ?? 0,
    },
    network: [],
    processes: [],
    disks: (over.disks ?? [["/", 10]]).map(([target, usePct]) => ({
      target, sizeMb: 100, usedMb: usePct, availMb: 100 - usePct, usePct,
    })),
    diskIo: { readBytesPerSec: 0, writeBytesPerSec: 0 },
    system: {
      hostname: "h", os: "o", kernel: "k", arch: "a", uptimeSecs: 1, cpuModel: "",
      virt: "", hasDocker: false, dockerDenied: false,
    },
    containers: [], containersLoaded: true,
    failedUnits: (over.failed ?? []).map((unit): FailedUnit => ({
      unit, result: "exit-code", exitStatus: "1", since: "", description: "",
    })),
    load: over.load === null ? null : { one: over.load ?? 0.1, five: 0, fifteen: 0 },
    sinceBoot: { netRxTotal: 0, netTxTotal: 0, diskReadTotal: 0, diskWriteTotal: 0, cpuAvgPct: 0 },
  };
}

const ON: AlertSettings = { ...DEFAULT_ALERTS, enabled: true, sustainSamples: 1 };

/** Feed a series of snapshots through evaluate, one second apart. */
function run(snaps: MonitorSnapshot[], s: AlertSettings, startMs = 1_000_000) {
  let alerts = evaluate(snaps[0], s, [], startMs);
  const history = [alerts];
  for (let i = 1; i < snaps.length; i++) {
    alerts = evaluate(snaps[i], s, alerts.alerts, startMs + i * 1000);
    history.push(alerts);
  }
  return { last: alerts, history };
}

describe("readings", () => {
  it("skips rules that are switched off", () => {
    const off: AlertSettings = {
      ...ON, cpu: { enabled: false, value: 85 }, memory: { enabled: false, value: 90 },
      disk: { enabled: false, value: 90 }, failedUnits: false,
    };
    expect(readings(snap({ cpu: 99 }), off)).toEqual([]);
  });

  it("reads one per mount, so a full /var is seen behind an empty /", () => {
    const r = readings(snap({ disks: [["/", 10], ["/var", 95]] }), ON);
    expect(r.filter((x) => x.kind === "disk").map((x) => [x.scope, x.value]))
      .toEqual([["/", 10], ["/var", 95]]);
  });

  it("ignores swap on a host that has none", () => {
    const s = { ...ON, swap: { enabled: true, value: 50 } };
    expect(readings(snap({ swapTotalKb: 0 }), s).some((r) => r.kind === "swap")).toBe(false);
    expect(readings(snap({ swapTotalKb: 100, swapUsedKb: 80 }), s).find((r) => r.kind === "swap")?.value).toBe(80);
  });

  it("measures load against the core count, not raw", () => {
    const s = { ...ON, loadPerCore: { enabled: true, value: 2 } };
    expect(readings(snap({ load: 8, cores: 4 }), s).find((r) => r.kind === "load")?.value).toBe(2);
  });

  it("has nothing to say about load when the CPU line is missing", () => {
    const s = { ...ON, loadPerCore: { enabled: true, value: 2 } };
    expect(readings(snap({ cpu: null, load: 8 }), s).some((r) => r.kind === "load")).toBe(false);
  });
});

describe("firing", () => {
  it("stays quiet while everything is under its threshold", () => {
    const r = evaluate(snap({ cpu: 20 }), ON, [], 0);
    expect(r.alerts).toEqual([]);
    expect(r.fired).toEqual([]);
  });

  it("fires once the breach has lasted the sustain count, not before", () => {
    const s = { ...ON, sustainSamples: 3 };
    const { history } = run([snap({ cpu: 95 }), snap({ cpu: 95 }), snap({ cpu: 95 })], s);
    expect(history[0].fired).toEqual([]);
    expect(history[1].fired).toEqual([]);
    expect(history[2].fired).toHaveLength(1);
    expect(history[2].fired[0].kind).toBe("cpu");
    expect(history[2].fired[0].value).toBe(95);
  });

  it("a one-sample spike never fires", () => {
    const s = { ...ON, sustainSamples: 3 };
    const { history } = run([snap({ cpu: 99 }), snap({ cpu: 10 }), snap({ cpu: 99 })], s);
    expect(history.flatMap((h) => h.fired)).toEqual([]);
  });

  it("does not re-fire on every sample while the breach continues", () => {
    const { history } = run(Array(10).fill(snap({ cpu: 95 })), ON);
    expect(history.flatMap((h) => h.fired)).toHaveLength(1);
  });

  it("fires again once the cooldown has passed", () => {
    const s = { ...ON, cooldownMins: 1 };
    let r = evaluate(snap({ cpu: 95 }), s, [], 0);
    expect(r.fired).toHaveLength(1);
    r = evaluate(snap({ cpu: 95 }), s, r.alerts, 30_000);
    expect(r.fired).toEqual([]);
    r = evaluate(snap({ cpu: 95 }), s, r.alerts, 60_000);
    expect(r.fired).toHaveLength(1);
  });

  it("a mount has its own alert, named by its mount point", () => {
    const r = evaluate(snap({ disks: [["/", 10], ["/var", 95]] }), ON, [], 0);
    expect(r.fired).toHaveLength(1);
    expect(r.fired[0].scope).toBe("/var");
    expect(r.fired[0].id).toBe(idOf(CONN, "disk", "/var"));
  });

  it("a failed unit fires on the sample that finds it, whatever the sustain count", () => {
    const s = { ...ON, sustainSamples: 5 };
    const r = evaluate(snap({ failed: ["nginx.service"] }), s, [], 0);
    expect(r.fired.map((a) => [a.kind, a.scope])).toEqual([["failedUnit", "nginx.service"]]);
  });

  it("marks disk and swap as warnings, the rest as errors", () => {
    const s = { ...ON, swap: { enabled: true, value: 50 } };
    const r = evaluate(snap({ cpu: 95, disks: [["/", 95]], swapTotalKb: 100, swapUsedKb: 90 }), s, [], 0);
    const by = Object.fromEntries(r.fired.map((a) => [a.kind, a.severity]));
    expect(by).toEqual({ cpu: "error", disk: "warn", swap: "warn" });
  });

  it("nothing fires at all while alerts are switched off", () => {
    const r = evaluate(snap({ cpu: 99, disks: [["/", 99]], failed: ["x.service"] }), DEFAULT_ALERTS, [], 0);
    expect(r.alerts).toEqual([]);
  });
});

describe("clearing", () => {
  it("holds through a dip that is still inside the hysteresis margin", () => {
    // threshold 85, clears below 80 — 82 is a dip, not a recovery.
    const { history } = run([snap({ cpu: 95 }), snap({ cpu: 82 }), snap({ cpu: 95 })], ON);
    expect(history[1].cleared).toEqual([]);
    expect(history[1].alerts[0].clearedAt).toBeNull();
    expect(history.flatMap((h) => h.fired)).toHaveLength(1);
  });

  it("clears once it falls clear of the margin", () => {
    const { history } = run([snap({ cpu: 95 }), snap({ cpu: 70 })], ON);
    expect(history[1].cleared).toHaveLength(1);
    expect(history[1].alerts[0].clearedAt).not.toBeNull();
  });

  it("clears when the metric stops being reported at all", () => {
    const { history } = run([snap({ cpu: 95 }), snap({ cpu: null })], ON);
    expect(history[1].cleared).toHaveLength(1);
  });

  it("clears a disk alert when that mount goes away", () => {
    const { history } = run([snap({ disks: [["/mnt", 95]] }), snap({ disks: [["/", 10]] })], ON);
    expect(history[1].cleared.map((a) => a.scope)).toEqual(["/mnt"]);
  });

  it("clears a failed unit once it leaves the failed list", () => {
    const { history } = run([snap({ failed: ["a.service"] }), snap({ failed: [] })], ON);
    expect(history[1].cleared.map((a) => a.scope)).toEqual(["a.service"]);
  });

  it("a cleared alert needs the full threshold again, not just the margin", () => {
    const { history } = run([snap({ cpu: 95 }), snap({ cpu: 20 }), snap({ cpu: 82 })], ON);
    expect(history[2].fired).toEqual([]);
    expect(history[2].alerts[0].clearedAt).not.toBeNull();
  });

  it("a fresh breach after recovery fires again and restarts its clock", () => {
    const start = 1_000_000;
    const { history } = run([snap({ cpu: 95 }), snap({ cpu: 20 }), snap({ cpu: 95 })], ON, start);
    expect(history[2].fired).toHaveLength(1);
    expect(history[2].alerts[0].since).toBe(start + 2000);
  });

  it("does not report the same recovery twice", () => {
    const { history } = run([snap({ cpu: 95 }), snap({ cpu: 20 }), snap({ cpu: 20 })], ON);
    expect(history[1].cleared).toHaveLength(1);
    expect(history[2].cleared).toEqual([]);
    expect(history[2].alerts).toHaveLength(1);
  });
});

describe("clearBelow", () => {
  it("is the threshold less the hysteresis margin", () => {
    expect(clearBelow({ kind: "cpu", threshold: 85 })).toBe(80);
  });

  it("never goes negative", () => {
    expect(clearBelow({ kind: "load", threshold: 2 })).toBe(0);
  });

  it("has no margin for a binary rule", () => {
    expect(clearBelow({ kind: "failedUnit", threshold: 1 })).toBe(1);
  });
});

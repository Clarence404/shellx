import type { MonitorSnapshot } from "../types/monitor";
import type { Alert, AlertKind, AlertSettings } from "../types/alerts";
import { HYSTERESIS_PCT } from "../types/alerts";

/** What one rule reads out of a single snapshot, whether or not it is
 *  over the line. Keeping under-threshold readings is what lets an
 *  already-firing alert hold until the metric falls clear by the
 *  hysteresis margin. */
export interface Reading {
  kind: AlertKind;
  /** Mount point for disk, unit name for failedUnit, "" otherwise. */
  scope: string;
  value: number;
  threshold: number;
}

export interface EvalResult {
  /** Every alert for this connection — active and just-cleared. */
  alerts: Alert[];
  /** Alerts that crossed into firing on this sample; these are the ones
   *  worth a notification. */
  fired: Alert[];
  /** Alerts that stopped breaching on this sample. */
  cleared: Alert[];
}

function pct(used: number, total: number): number {
  return total > 0 ? (used / total) * 100 : 0;
}

export function idOf(connectionId: string, kind: AlertKind, scope: string): string {
  return `${connectionId}:${kind}:${scope}`;
}

/** Read every enabled rule against one snapshot. A rule whose metric is
 *  missing (no CPU line, no swap configured) yields no reading at all,
 *  which also clears any alert that was riding on it. */
export function readings(snap: MonitorSnapshot, s: AlertSettings): Reading[] {
  const out: Reading[] = [];

  if (s.cpu.enabled && snap.cpu) {
    out.push({ kind: "cpu", scope: "", value: snap.cpu.totalPct, threshold: s.cpu.value });
  }

  if (s.memory.enabled) {
    // "Used" excludes cache — the same number the KPI tile shows, so an
    // alert can never disagree with what is on screen.
    out.push({
      kind: "memory", scope: "",
      value: pct(snap.memory.usedKb, snap.memory.totalKb), threshold: s.memory.value,
    });
  }

  if (s.swap.enabled && snap.memory.swapTotalKb > 0) {
    out.push({
      kind: "swap", scope: "",
      value: pct(snap.memory.swapUsedKb, snap.memory.swapTotalKb), threshold: s.swap.value,
    });
  }

  if (s.disk.enabled) {
    // Per mount: a full /var matters even when / is empty.
    for (const d of snap.disks) {
      out.push({ kind: "disk", scope: d.target, value: d.usePct, threshold: s.disk.value });
    }
  }

  if (s.loadPerCore.enabled && snap.load) {
    const cores = snap.cpu?.corePct.length ?? 0;
    if (cores > 0) {
      out.push({
        kind: "load", scope: "",
        value: snap.load.one / cores, threshold: s.loadPerCore.value,
      });
    }
  }

  if (s.failedUnits) {
    // Binary: a unit is in `systemctl --failed` or it isn't. Listing it
    // at value 1 against threshold 1 lets it ride the same machinery,
    // and a unit that leaves the list simply stops being read.
    for (const u of snap.failedUnits) {
      out.push({ kind: "failedUnit", scope: u.unit, value: 1, threshold: 1 });
    }
  }

  return out;
}

/** Samples a rule must breach before it fires. A failed unit is already
 *  a fact when it is first seen — waiting three more polls to mention it
 *  would just be slow. */
function sustainFor(kind: AlertKind, s: AlertSettings): number {
  return kind === "failedUnit" ? 1 : s.sustainSamples;
}

function severityOf(kind: AlertKind): Alert["severity"] {
  // Disk filling is urgent but gradual; a wedged service or a pegged CPU
  // is the kind of thing you want to look at now.
  return kind === "disk" || kind === "swap" ? "warn" : "error";
}

/** Where an already-firing alert stops: a margin below the threshold, so
 *  a metric sitting on the line doesn't fire and clear on alternating
 *  samples. Binary rules have no margin. */
export function clearBelow(r: { kind: AlertKind; threshold: number }): number {
  return r.kind === "failedUnit" ? r.threshold : Math.max(0, r.threshold - HYSTERESIS_PCT);
}

/**
 * Fold one snapshot into the alerts carried over from the previous one.
 *
 * Pure: same inputs, same outputs, no clock of its own — `now` is passed
 * in so tests can drive cooldowns without waiting. `prev` is the list
 * this function returned last time for the same connection.
 */
export function evaluate(
  snap: MonitorSnapshot,
  settings: AlertSettings,
  prev: Alert[],
  now: number,
): EvalResult {
  if (!settings.enabled) return { alerts: [], fired: [], cleared: [] };

  const current = new Map<string, Reading>();
  for (const r of readings(snap, settings)) {
    current.set(idOf(snap.connectionId, r.kind, r.scope), r);
  }

  const alerts: Alert[] = [];
  const fired: Alert[] = [];
  const cleared: Alert[] = [];
  const seen = new Set<string>();
  const cooldownMs = settings.cooldownMins * 60_000;

  for (const old of prev) {
    seen.add(old.id);
    const r = current.get(old.id);
    const active = old.clearedAt === null;
    // An active alert holds until it falls clear of the margin; a cleared
    // one needs a fresh breach at the full threshold to come back.
    const holds = r !== undefined && (active ? r.value >= clearBelow(r) : r.value >= r.threshold);

    if (!holds) {
      if (active) {
        const next: Alert = { ...old, clearedAt: now, samples: 0, value: r?.value ?? old.value };
        alerts.push(next);
        cleared.push(next);
      } else {
        // Already cleared on an earlier sample — kept so the Alerts tab
        // can show what just recovered; the store ages it out.
        alerts.push(old);
      }
      continue;
    }

    const samples = old.samples + 1;
    // Breaching again after a recovery is a new incident, so it is not
    // held back by the cooldown the previous one left behind.
    const firedAt = active ? old.firedAt : null;
    // Fires when it first reaches the sustain count, and again only after
    // the cooldown — a rule breached for an hour is one alert, not one
    // per sample.
    const due = samples >= sustainFor(old.kind, settings)
      && (firedAt === null || now - firedAt >= cooldownMs);
    const next: Alert = {
      ...old,
      value: r.value,
      threshold: r.threshold,
      samples,
      // Coming back from cleared restarts the clock on "since".
      since: active ? old.since : now,
      clearedAt: null,
      firedAt: due ? now : firedAt,
    };
    alerts.push(next);
    if (due) fired.push(next);
  }

  for (const [id, r] of current) {
    if (seen.has(id) || r.value < r.threshold) continue;
    const a: Alert = {
      id,
      connectionId: snap.connectionId,
      kind: r.kind,
      scope: r.scope,
      severity: severityOf(r.kind),
      value: r.value,
      threshold: r.threshold,
      since: now,
      firedAt: null,
      clearedAt: null,
      samples: 1,
    };
    if (a.samples >= sustainFor(a.kind, settings)) {
      a.firedAt = now;
      fired.push(a);
    }
    alerts.push(a);
  }

  return { alerts, fired, cleared };
}

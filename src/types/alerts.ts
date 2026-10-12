/** One numeric rule: a percentage (or a load multiple) the metric must
 *  stay under. Each can be turned off on its own. */
export interface AlertThreshold {
  enabled: boolean;
  value: number;
}

/** Settings → Alerts. One global set, shared by every host. Per-host
 *  overrides are deliberately not here — they would need a hosts column
 *  and a second place to look when an alert surprises you. */
export interface AlertSettings {
  /** Master switch. Off → no sampling in the background, no alerts. */
  enabled: boolean;
  /** Also raise an OS notification, so an alert lands while the window
   *  is behind something else. */
  systemNotifications: boolean;
  cpu: AlertThreshold;
  memory: AlertThreshold;
  disk: AlertThreshold;
  swap: AlertThreshold;
  /** Load average (1 min) divided by core count. 2 means "twice as many
   *  runnable tasks as cores". */
  loadPerCore: AlertThreshold;
  /** A unit entering `systemctl --failed` is its own alert — no number
   *  to pick, so it is a plain toggle. */
  failedUnits: boolean;
  /** Consecutive breaching samples before an alert fires. A spike that
   *  lasts one tick is not worth a notification. */
  sustainSamples: number;
  /** Minutes before the same rule may fire again while still breaching. */
  cooldownMins: number;
}

export const DEFAULT_ALERTS: AlertSettings = {
  enabled: false,
  systemNotifications: true,
  cpu: { enabled: true, value: 85 },
  memory: { enabled: true, value: 90 },
  disk: { enabled: true, value: 90 },
  swap: { enabled: false, value: 50 },
  loadPerCore: { enabled: false, value: 2 },
  failedUnits: true,
  sustainSamples: 3,
  cooldownMins: 10,
};

/** [min, max] per numeric field, shared by the panel's controls and the
 *  store's clamping so the two can't drift. Mirrored in Rust. */
export const ALERT_RANGES = {
  cpu: [50, 100],
  memory: [50, 100],
  disk: [50, 100],
  swap: [10, 100],
  loadPerCore: [1, 10],
  sustainSamples: [1, 20],
  cooldownMins: [1, 120],
} as const;

/** How far below its threshold a metric must fall before the alert is
 *  considered over. Without it, a metric sitting exactly on the line
 *  fires and clears on alternating samples. */
export const HYSTERESIS_PCT = 5;

export type AlertKind = "cpu" | "memory" | "disk" | "swap" | "load" | "failedUnit";

export type AlertSeverity = "warn" | "error";

/** A rule that is currently breaching, or recently was. One per
 *  (connection, kind, scope) — `scope` separates per-mount disk rules and
 *  names the unit for a failed-service alert. */
export interface Alert {
  /** `${connectionId}:${kind}:${scope}` — stable across samples. */
  id: string;
  connectionId: string;
  kind: AlertKind;
  /** Mount point for disk, unit name for failedUnit, "" otherwise. */
  scope: string;
  severity: AlertSeverity;
  /** The reading that fired (or most recently updated) the alert. */
  value: number;
  threshold: number;
  /** ms epoch the rule started breaching. */
  since: number;
  /** ms epoch the alert last fired a notification; null until it has. */
  firedAt: number | null;
  /** ms epoch it stopped breaching; null while still active. */
  clearedAt: number | null;
  /** Consecutive breaching samples so far. */
  samples: number;
}

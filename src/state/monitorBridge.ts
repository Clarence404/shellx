import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { MonitorSnapshot } from "../types/monitor";
import type { ConnectionInfo } from "../types/connection";
import { startMonitor, stopMonitor } from "../ipc/monitor";
import { useMonitorStore } from "./monitor";
import { useAlerts } from "./alerts";
import { useAlertToasts } from "./alertToasts";
import { useSessions } from "./sessions";
import { useSettingsStore } from "./settings";
import { notifyOs } from "../ipc/notify";
import type { Alert } from "../types/alerts";
import { alertDetail, notificationTitle } from "./alertText";
import { translate } from "../i18n";

/** Sampling rate for a connection nobody is looking at. Slow enough to
 *  be cheap on a dozen open sessions, fast enough that a sustain count
 *  of 3 is still half a minute, not five. */
export const BACKGROUND_INTERVAL_SECS = 10;

/** What each open monitor panel wants, by connection id. A panel
 *  registers while it is mounted; the bridge owns every start/stop so
 *  the two can't fight over the poll rate. */
const panelIntervals = new Map<string, number>();

/** What the backend is currently running, so an unchanged interval
 *  doesn't restart the poll loop on every settings keystroke. */
const running = new Map<string, number>();

/**
 * The poll interval each connection should be sampled at, or absent if
 * it should not be sampled at all. An open panel wins over the
 * background rate; with alerts off, only open panels sample.
 *
 * Pure, so the policy can be tested without a backend.
 */
export function desiredIntervals(
  panels: Map<string, number>,
  sessions: ConnectionInfo[],
  alertsEnabled: boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    // Only SSH hosts have /proc to read; local shells and serial ports
    // have no monitor to run.
    if (s.kind !== "ssh" || s.state !== "active") continue;
    const panel = panels.get(s.id);
    if (panel !== undefined) out.set(s.id, panel);
    else if (alertsEnabled) out.set(s.id, BACKGROUND_INTERVAL_SECS);
  }
  return out;
}

/** Apply a desired map against what is running, starting, re-rating and
 *  stopping only where they differ. */
function reconcile(): void {
  const { sessions } = useSessions.getState();
  const alertsEnabled = useSettingsStore.getState().alerts.enabled;
  const want = desiredIntervals(panelIntervals, sessions, alertsEnabled);

  for (const [id, secs] of want) {
    if (running.get(id) === secs) continue;
    running.set(id, secs);
    void startMonitor(id, secs).catch(() => { running.delete(id); });
  }
  for (const id of [...running.keys()]) {
    if (want.has(id)) continue;
    running.delete(id);
    void stopMonitor(id).catch(() => {});
    // A connection nobody samples has no live readings behind its
    // alerts, so they go rather than sit there stale.
    useAlerts.getState().clear(id);
    useMonitorStore.getState().clear(id);
  }
}

/** An open monitor panel claims a sampling rate for its connection. */
export function claimMonitor(connId: string, intervalSecs: number): void {
  panelIntervals.set(connId, intervalSecs);
  reconcile();
}

/** The panel closed: back to the background rate, or off. */
export function releaseMonitor(connId: string): void {
  panelIntervals.delete(connId);
  reconcile();
}

function hostLabel(connId: string): string {
  return useSessions.getState().sessions.find((s) => s.id === connId)?.label ?? connId;
}

/** Raise fired alerts: a toast always, an OS notification when the user
 *  asked for one. */
async function announce(connId: string, fired: Alert[]): Promise<void> {
  const label = hostLabel(connId);
  const t = (key: string) => translate(useSettingsStore.getState().language, key);
  for (const a of fired) {
    useAlertToasts.getState().show(a, label);
    if (useSettingsStore.getState().alerts.systemNotifications) {
      await notifyOs(notificationTitle(a, label, t), alertDetail(a, t));
    }
  }
}

let unlisten: UnlistenFn | undefined;
let unsubscribe: Array<() => void> = [];

/**
 * Start the one global snapshot subscriber.
 *
 * Every snapshot — whether a panel is open or not — lands in the monitor
 * store and is folded into the alert rules here, so alerts keep working
 * while the user is somewhere else in the app. Called once from the app
 * shell; calling it again is a no-op.
 */
export async function startMonitorBridge(): Promise<void> {
  if (unlisten) return;
  unlisten = await listen<MonitorSnapshot>("monitor:snapshot", (ev) => {
    const snap = ev.payload;
    useMonitorStore.getState().push(snap);
    const fired = useAlerts.getState().ingest(snap);
    if (fired.length) void announce(snap.connectionId, fired);
  });

  // Sessions coming and going, and the alerts switch itself, both change
  // what should be sampled.
  unsubscribe.push(useSessions.subscribe(reconcile));
  unsubscribe.push(useSettingsStore.subscribe(() => {
    if (!useSettingsStore.getState().alerts.enabled) useAlerts.getState().clearAll();
    reconcile();
  }));
  reconcile();
}

/** Tear the bridge down — tests, and a clean shutdown. */
export function stopMonitorBridge(): void {
  unlisten?.();
  unlisten = undefined;
  for (const u of unsubscribe) u();
  unsubscribe = [];
  panelIntervals.clear();
  for (const id of [...running.keys()]) void stopMonitor(id).catch(() => {});
  running.clear();
}

// Dev only: a real alert needs a host that is actually under load, so let
// the console stage one to look at the toast, the sidebar badge and the
// Alerts tab — `__shellxFakeAlert()` in the devtools console. It targets
// the active session unless given a connection id. Compiled out of
// production builds.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__shellxFakeAlert = (connId?: string) => {
    const id = connId ?? useSessions.getState().activeId ?? "demo";
    const now = Date.now();
    const mk = (
      kind: Alert["kind"], scope: string, value: number, threshold: number,
      severity: Alert["severity"],
    ): Alert => ({
      id: `${id}:${kind}:${scope}`, connectionId: id, kind, scope, severity,
      value, threshold, since: now, firedAt: now, clearedAt: null, samples: 4,
    });
    const staged = [mk("cpu", "", 96, 85, "error"), mk("disk", "/", 93, 90, "warn")];
    useAlerts.setState((s) => ({ byConn: { ...s.byConn, [id]: staged } }));
    void announce(id, staged);
    return staged;
  };
}

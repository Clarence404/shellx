import type { Alert } from "../types/alerts";

type T = (s: string) => string;

/** One-line title, e.g. "CPU stayed high" — the headline in the Alerts
 *  tab, the toast and the OS notification all read the same. */
export function alertTitle(a: Alert, t: T): string {
  switch (a.kind) {
    case "cpu": return t("CPU stayed high");
    case "memory": return t("Memory stayed high");
    case "swap": return t("Swap in heavy use");
    case "disk": return t("Disk is filling up");
    case "load": return t("Load average is high");
    case "failedUnit": return t("Service failed");
  }
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** The sentence under the title: what the reading was, against what. */
export function alertDetail(a: Alert, t: T): string {
  if (a.kind === "failedUnit") {
    return a.clearedAt !== null
      ? `${a.scope} — ${t("recovered")}`
      : `${a.scope} ${t("entered the failed state.")}`;
  }
  if (a.clearedAt !== null) {
    const now = a.kind === "load" ? a.value.toFixed(2) : pct(a.value);
    return `${t("Recovered, now")} ${now}.`;
  }
  const limit = a.kind === "load" ? `${a.threshold}x` : pct(a.threshold);
  const value = a.kind === "load" ? a.value.toFixed(2) : pct(a.value);
  const where = a.kind === "disk" ? ` ${t("on")} ${a.scope}` : "";
  const sustained = a.samples > 1 ? ` ${t("for")} ${a.samples} ${t("samples")}` : "";
  return `${value}${where}${sustained} (${t("threshold")} ${limit}).`;
}

/** Title line for an OS notification: the host comes first, because the
 *  notification may be the only place the host is named. */
export function notificationTitle(a: Alert, hostLabel: string, t: T): string {
  return `${hostLabel} — ${alertTitle(a, t)}`;
}

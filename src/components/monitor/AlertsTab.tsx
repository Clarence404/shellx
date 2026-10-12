import { TriangleAlert, CircleCheck, SlidersHorizontal } from "lucide-react";
import type { Alert } from "../../types/alerts";
import type { FailedUnit } from "../../types/monitor";
import { alertTitle, alertDetail } from "../../state/alertText";
import { FailedTab } from "./FailedTab";
import { useT } from "../../i18n";

function ago(ms: number, t: (s: string) => string): string {
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return t("just now");
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} ${t("min ago")}`;
  return `${Math.round(mins / 60)} ${t("h ago")}`;
}

function AlertCard({ alert }: { alert: Alert }) {
  const t = useT();
  const cleared = alert.clearedAt !== null;
  const accent = cleared ? "var(--success)" : alert.severity === "warn" ? "var(--warning, #e8a33d)" : "var(--error)";
  return (
    <div style={{
      border: "1px solid var(--border)", borderLeft: `3px solid ${accent}`,
      borderRadius: "0 8px 8px 0", padding: "10px 12px", marginBottom: 8,
      background: "var(--panel-1)", opacity: cleared ? 0.72 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {cleared
          ? <CircleCheck size={13} style={{ color: "var(--success)", flexShrink: 0 }} />
          : <TriangleAlert size={13} style={{ color: accent, flexShrink: 0 }} />}
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>{alertTitle(alert, t)}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 999,
          color: accent, background: cleared ? "var(--success-fade, transparent)" : "transparent",
          border: `1px solid ${accent}`,
        }}>{cleared ? t("Recovered") : t("Firing")}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>
          {ago(cleared ? alert.clearedAt! : alert.since, t)}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3 }}>{alertDetail(alert, t)}</div>
    </div>
  );
}

/**
 * The monitor's Alerts tab: threshold alerts on top, then the systemd
 * failed-unit detail that has always lived here. A failed unit is also
 * an alert (it is what raises the notification), but it is listed once —
 * below, where the unit's result and command are.
 */
export function AlertsTab({ alerts, units, onOpenSettings }: {
  alerts: Alert[];
  units: FailedUnit[];
  onOpenSettings?: () => void;
}) {
  const t = useT();
  const thresholdAlerts = alerts.filter((a) => a.kind !== "failedUnit");

  return (
    <div>
      {thresholdAlerts.length > 0 && (
        <div style={{ padding: "12px 16px 0" }}>
          <div style={{
            fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)",
            fontWeight: 700, margin: "2px 2px 10px", display: "flex", alignItems: "center", gap: 8,
          }}>
            {t("Thresholds")} · {thresholdAlerts.filter((a) => a.clearedAt === null).length} {t("firing")}
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                style={{
                  marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 5,
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  color: "var(--text-3)", font: "inherit", fontSize: 10, letterSpacing: 0.4,
                  textTransform: "uppercase", fontWeight: 700,
                }}
              ><SlidersHorizontal size={12} /> {t("Adjust")}</button>
            )}
          </div>
          {thresholdAlerts.map((a) => <AlertCard key={a.id} alert={a} />)}
        </div>
      )}
      {units.length > 0 && <FailedTab units={units} />}
      {thresholdAlerts.length === 0 && units.length === 0 && (
        <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
          {t("No alerts.")}
        </div>
      )}
    </div>
  );
}

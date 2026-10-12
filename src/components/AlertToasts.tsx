import { useEffect } from "react";
import { TriangleAlert, X } from "lucide-react";
import { useAlertToasts, TOAST_MS, type Toast } from "../state/alertToasts";
import { alertTitle, alertDetail } from "../state/alertText";
import { useT } from "../i18n";

function ToastCard({ toast }: { toast: Toast }) {
  const t = useT();
  const { alert, hostLabel, key } = toast;
  const accent = alert.severity === "warn" ? "var(--warning, #e8a33d)" : "var(--error)";

  // Each toast owns its own timer, so a second alert arriving doesn't
  // restart the countdown on the first.
  useEffect(() => {
    const id = setTimeout(() => useAlertToasts.getState().dismiss(key), TOAST_MS);
    return () => clearTimeout(id);
  }, [key]);

  return (
    <div
      role="status"
      style={{
        width: 320, background: "var(--panel-1)", color: "var(--text-1)",
        border: "1px solid var(--border)", borderLeft: `3px solid ${accent}`,
        borderRadius: 9, boxShadow: "0 14px 40px rgba(0,0,0,0.26)",
        padding: "11px 13px", animation: "shellx-fade-in 140ms ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <TriangleAlert size={13} style={{ color: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {hostLabel} · {alertTitle(alert, t)}
        </span>
        <button
          onClick={() => useAlertToasts.getState().dismiss(key)}
          aria-label={t("Close")}
          title={t("Close")}
          style={{
            marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
            color: "var(--text-3)", display: "flex", padding: 2, flexShrink: 0,
          }}
        ><X size={14} /></button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3 }}>{alertDetail(alert, t)}</div>
    </div>
  );
}

/**
 * Alert toasts, bottom-right. A nudge only — every alert also sits in
 * the host's monitor under Alerts, so letting one time out loses
 * nothing.
 */
export function AlertToasts() {
  const toasts = useAlertToasts((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: "fixed", right: 16, bottom: 16, zIndex: 900,
      display: "flex", flexDirection: "column", gap: 8, pointerEvents: "auto",
    }}>
      {toasts.map((t) => <ToastCard key={t.key} toast={t} />)}
    </div>
  );
}

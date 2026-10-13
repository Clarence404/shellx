import { useEffect } from "react";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import { useToasts, type Toast } from "../state/toasts";
import { useT } from "../i18n";

function toneColor(tone: Toast["tone"]): string {
  if (tone === "error") return "var(--error)";
  if (tone === "warn") return "var(--warning, #e8a33d)";
  return "var(--success)";
}

function ToneIcon({ tone }: { tone: Toast["tone"] }) {
  const color = toneColor(tone);
  if (tone === "info") return <Check size={13} strokeWidth={3} style={{ color, flexShrink: 0 }} />;
  if (tone === "warn") return <Info size={13} style={{ color, flexShrink: 0 }} />;
  return <TriangleAlert size={13} style={{ color, flexShrink: 0 }} />;
}

function ToastCard({ toast }: { toast: Toast }) {
  const t = useT();
  const { key, title, body, tone, mono, ttl } = toast;

  // Each toast owns its own timer, so a second one arriving doesn't
  // restart the countdown on the first.
  useEffect(() => {
    const id = setTimeout(() => useToasts.getState().dismiss(key), ttl);
    return () => clearTimeout(id);
  }, [key, ttl]);

  return (
    <div
      role="status"
      style={{
        width: 320, background: "var(--panel-1)", color: "var(--text-1)",
        border: "1px solid var(--border)", borderLeft: `3px solid ${toneColor(tone)}`,
        borderRadius: 9, boxShadow: "0 14px 40px rgba(0,0,0,0.26)",
        padding: "11px 13px", animation: "shellx-fade-in 140ms ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <ToneIcon tone={tone} />
        <span style={{
          fontSize: 12, fontWeight: 600, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{title}</span>
        <button
          onClick={() => useToasts.getState().dismiss(key)}
          aria-label={t("Close")}
          title={t("Close")}
          style={{
            marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
            color: "var(--text-3)", display: "flex", padding: 2, flexShrink: 0,
          }}
        ><X size={14} /></button>
      </div>
      {body && (
        <div style={{
          fontSize: 11, color: "var(--text-2)", marginTop: 4,
          fontFamily: mono ? "var(--font-mono)" : undefined,
          // A copied command is long: let it wrap rather than truncate,
          // since the point is to see exactly what went to the clipboard.
          wordBreak: mono ? "break-all" : "normal",
        }}>{body}</div>
      )}
    </div>
  );
}

/**
 * The app's toast stack, bottom-right. Transient by design: everything
 * shown here is also recorded somewhere durable (alerts in the monitor's
 * Alerts tab, a copy in the clipboard itself), so letting one time out
 * loses nothing.
 */
export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: "fixed", right: 16, bottom: 16, zIndex: 900,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {toasts.map((toast) => <ToastCard key={toast.key} toast={toast} />)}
    </div>
  );
}

import { Download } from "lucide-react";
import { useUpdater } from "../state/updater";
import { useT } from "../i18n";

/**
 * The titlebar's "Update" button: there while an update is waiting (or
 * downloading), so it can be reopened after the dialog was closed. Hidden once
 * the user skips that version.
 */
export function UpdatePill() {
  const t = useT();
  const { status, version, ignored, progress } = useUpdater();
  const waiting = status === "available" || status === "downloading";
  if (!waiting || !version || ignored === version) return null;

  const label = status === "downloading" && progress > 0
    ? `${Math.round(progress * 100)}%`
    : t("Update");

  return (
    <button
      onClick={() => useUpdater.getState().openDialog()}
      title={`${t("Update available")} · v${version}`}
      aria-label={t("Update available")}
      style={{
        flexShrink: 0, height: 24, margin: "0 6px", padding: "0 11px", borderRadius: 999,
        display: "inline-flex", alignItems: "center", gap: 5,
        background: "var(--accent)", color: "var(--text-on-accent)", border: "none",
        fontSize: 12, fontWeight: 600, cursor: "pointer",
      }}
    >
      <Download size={12} strokeWidth={2.4} />
      {label}
    </button>
  );
}

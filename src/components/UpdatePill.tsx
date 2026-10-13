import { useState } from "react";
import { CloudDownload, Download } from "lucide-react";
import { useUpdater } from "../state/updater";
import { useT } from "../i18n";

/**
 * The titlebar's update button, always there. While an update is waiting (or
 * downloading) it is the blue "Update" pill that opens the dialog — hidden
 * once the user skips that version. Otherwise it is a quiet icon button that
 * opens the update dialog and checks from inside it, so the answer — a found
 * update, "already current", or a failed check — stays on screen instead of
 * flashing past in the titlebar.
 */
export function UpdatePill() {
  const t = useT();
  const { status, version, ignored, progress } = useUpdater();
  const [hover, setHover] = useState(false);

  const waiting = status === "available" || status === "downloading";
  if (waiting && version && ignored !== version) {
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

  const checking = status === "checking";

  return (
    <button
      onClick={() => void useUpdater.getState().checkInDialog()}
      disabled={checking}
      aria-label={t("Check for updates")}
      title={t("Check for updates")}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: 22, width: 26, marginRight: 4,
        border: "1px solid var(--border)",
        background: hover ? "var(--panel-2)" : "var(--panel-1)",
        color: hover ? "var(--text-1)" : "var(--text-3)",
        borderRadius: 6, cursor: checking ? "default" : "pointer",
      }}
    >
      <CloudDownload
        size={14}
        style={checking ? { animation: "shellx-dot-pulse 1.2s ease-in-out infinite" } : undefined}
      />
    </button>
  );
}

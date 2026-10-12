import { useEffect, useState } from "react";
import { CircleArrowUp, CircleCheck, Download, RefreshCw } from "lucide-react";
import { useUpdater } from "../state/updater";
import { useT } from "../i18n";

/**
 * The titlebar's update button, always there. While an update is waiting (or
 * downloading) it is the blue "Update" pill that opens the dialog — hidden
 * once the user skips that version. Otherwise it is a quiet icon button that
 * checks for updates on click: a found one opens the dialog, "already latest"
 * flashes a check mark.
 */
export function UpdatePill() {
  const t = useT();
  const { status, version, ignored, progress, error } = useUpdater();
  const [hover, setHover] = useState(false);
  const [flash, setFlash] = useState(false);

  // "Up to date" is a result, not a state to sit in: show the tick briefly.
  useEffect(() => {
    if (status !== "upToDate") { setFlash(false); return; }
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 2500);
    return () => clearTimeout(id);
  }, [status]);

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
  const onCheck = async () => {
    await useUpdater.getState().check(false);
    // An explicit click on a version that was skipped still shows it.
    if (useUpdater.getState().status === "available") useUpdater.getState().openDialog();
  };
  const title = checking ? t("Checking…")
    : flash ? t("Up to date")
    : status === "error" ? `${t("Update check failed")}${error ? `: ${error}` : ""}`
    : t("Check for updates");

  return (
    <button
      onClick={() => void onCheck()}
      disabled={checking}
      aria-label={t("Check for updates")}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
        height: 22, width: 26, marginRight: 4,
        border: "1px solid var(--border)",
        background: hover ? "var(--panel-2)" : "var(--panel-1)",
        color: flash ? "var(--ok, #2fbf71)" : hover ? "var(--text-1)" : "var(--text-3)",
        borderRadius: 6, cursor: checking ? "default" : "pointer",
      }}
    >
      {checking ? <RefreshCw size={13} className="shellx-spin" />
        : flash ? <CircleCheck size={14} />
        : <CircleArrowUp size={14} />}
    </button>
  );
}

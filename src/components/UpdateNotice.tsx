import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useUpdater } from "../state/updater";
import { useT } from "../i18n";
import { ReleaseNotes } from "./ReleaseNotes";

const DISMISSED_KEY = "shellx.updateNoticeDismissedVersion";

function dismissedVersion(): string | null {
  try { return localStorage.getItem(DISMISSED_KEY); } catch { return null; }
}
function setDismissedVersion(v: string) {
  try { localStorage.setItem(DISMISSED_KEY, v); } catch { /* private mode */ }
}

/**
 * A non-blocking "what's new" card for updates the silent startup check
 * found — shown once per version (dismissing it, or downloading, both
 * count as seen; a manual "Check for updates" click never shows this, since
 * that already puts the user in front of the Settings → About banner).
 */
export function UpdateNotice() {
  const t = useT();
  const { status, version, notes, foundSilently } = useUpdater();
  // Dismissal is per-render-lifetime local state, seeded from the
  // last-seen version stored on a previous launch — a plain localStorage
  // read wouldn't by itself trigger a re-render on dismiss.
  const [closedFor, setClosedFor] = useState(dismissedVersion);

  const eligible = status === "available" && foundSilently && !!version;
  if (!eligible || closedFor === version) return null;

  function dismiss() {
    if (version) { setDismissedVersion(version); setClosedFor(version); }
  }

  return (
    <div style={{
      position: "fixed", right: 16, bottom: 16, zIndex: 50,
      width: 340, maxHeight: "60vh", overflowY: "auto",
      background: "var(--panel-1)", border: "1px solid var(--accent)",
      borderRadius: 10, boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
      padding: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Sparkles size={15} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
          {t("What's new in")} v{version}
        </span>
        <button
          onClick={dismiss}
          title={t("Dismiss")}
          style={{
            marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
            color: "var(--text-3)", display: "flex", padding: 2, flexShrink: 0,
          }}
        ><X size={14} /></button>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 12 }}>
        {notes ? <ReleaseNotes text={notes} /> : t("A new version is ready to download.")}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={dismiss}
          style={{
            flex: 1, padding: "6px 10px", borderRadius: 5, fontSize: 12,
            border: "1px solid var(--border)", background: "transparent", color: "var(--text-2)",
            cursor: "pointer",
          }}
        >{t("Later")}</button>
        <button
          onClick={() => {
            dismiss();
            void useUpdater.getState().downloadAndInstall();
          }}
          style={{
            flex: 1, padding: "6px 10px", borderRadius: 5, fontSize: 12, fontWeight: 600,
            border: "none", background: "var(--accent)", color: "var(--text-on-accent)",
            cursor: "pointer",
          }}
        >{t("Download & restart")}</button>
      </div>
    </div>
  );
}

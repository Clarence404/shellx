import { useEffect } from "react";
import { Sparkles, X } from "lucide-react";
import { useUpdater } from "../state/updater";
import { useT, useLanguage } from "../i18n";
import { ReleaseNotes } from "./ReleaseNotes";
import { notesForLanguage } from "../state/releaseNotesLang";
import { externalLinkProps } from "../ipc/external";

const DOWNLOAD_PAGE = "https://github.com/Clarence404/shellx/releases/latest";

function fmtBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The "what's new" dialog: the version, what changed in it (the release notes
 * from the updater manifest), and what to do — update now, open the download
 * page, or skip this version. It opens by itself once per version when the
 * silent startup check finds one, and any time from the titlebar's Update
 * button. Closing it (×, Esc, clicking outside) counts as having seen it.
 */
export function UpdateDialog() {
  const t = useT();
  const { status, version, notes, dialogOpen, progress, received, total, error } = useUpdater();
  const lang = useLanguage();
  // The manifest carries both languages; show the one the UI is in.
  const localized = notesForLanguage(notes, lang);
  const current = import.meta.env.PACKAGE_VERSION;
  const open = dialogOpen && !!version && (status === "available" || status === "downloading" || status === "error");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); useUpdater.getState().closeDialog(); }
    };
    // Capture: a dialog on screen gets Escape before anything underneath.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) return null;

  const close = () => useUpdater.getState().closeDialog();
  const downloading = status === "downloading";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("Update available")}
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "shellx-fade-in 120ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: "calc(100vw - 48px)", maxHeight: "82vh",
          display: "flex", flexDirection: "column",
          background: "var(--panel-2)", border: "0.5px solid var(--border)", borderRadius: 10,
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px 10px" }}>
          <Sparkles size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)" }}>{t("Update available")}</span>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 999,
            background: "var(--accent-fade)", color: "var(--accent)",
          }}>v{version}</span>
          <button
            onClick={close}
            aria-label={t("Close")}
            title={t("Close")}
            style={{
              marginLeft: "auto", background: "none", border: "none", cursor: "pointer",
              color: "var(--text-3)", display: "flex", padding: 4, flexShrink: 0,
            }}
          ><X size={16} /></button>
        </div>

        <div style={{ padding: "0 20px 12px", fontSize: 12, color: "var(--text-2)" }}>
          {t("Current version")} v{current} → {t("New version")} v{version}
        </div>

        {/* what's new */}
        <div style={{
          margin: "0 20px", padding: "12px 14px", overflowY: "auto", minHeight: 80,
          border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel-1)",
          fontSize: 12, color: "var(--text-2)",
        }}>
          {localized
            ? <ReleaseNotes text={localized} />
            : <span style={{ color: "var(--text-3)" }}>{t("No release notes were published for this version.")}</span>}
        </div>

        {/* footer */}
        <div style={{ padding: "14px 20px 16px" }}>
          {downloading ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6, color: "var(--text-1)" }}>
                <span>{t("Downloading…")}</span>
                {progress > 0 && <span style={{ color: "var(--text-2)" }}>{Math.round(progress * 100)}%</span>}
              </div>
              <div style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                {progress > 0 ? (
                  <div style={{
                    position: "absolute", top: 0, left: 0, height: "100%", borderRadius: 4,
                    background: "var(--accent)", width: `${progress * 100}%`, transition: "width 200ms ease",
                  }} />
                ) : (
                  <div style={{
                    position: "absolute", top: 0, height: "100%", width: "40%", borderRadius: 4,
                    background: "linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%)",
                    animation: "shellx-progress-sweep 1.4s ease-in-out infinite",
                  }} />
                )}
              </div>
              {received > 0 && (
                <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>
                  {fmtBytes(received)}{total > 0 ? ` / ${fmtBytes(total)}` : ""}
                </div>
              )}
            </>
          ) : (
            <>
              {status === "error" && (
                <div style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 10 }} title={error ?? undefined}>
                  {t("The download didn't finish — try again, or use the download page.")}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => useUpdater.getState().ignoreVersion()}
                  style={{
                    background: "none", border: "none", cursor: "pointer", padding: "6px 4px",
                    fontSize: 12, color: "var(--text-3)",
                  }}
                >{t("Skip this version")}</button>
                <span style={{ flex: 1 }} />
                <a
                  {...externalLinkProps(DOWNLOAD_PAGE)}
                  style={{
                    padding: "6px 12px", borderRadius: 5, fontSize: 12, textDecoration: "none",
                    border: "1px solid var(--border-hi)", color: "var(--text-1)",
                  }}
                >{t("Open download page")}</a>
                <button
                  autoFocus
                  onClick={() => void useUpdater.getState().downloadAndInstall()}
                  style={{
                    padding: "6px 14px", borderRadius: 5, fontSize: 12, fontWeight: 600,
                    border: "none", background: "var(--accent)", color: "var(--text-on-accent)", cursor: "pointer",
                  }}
                >{status === "error" ? t("Retry") : t("Download & restart")}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

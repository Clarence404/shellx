import { useEffect, useState } from "react";
import { ExternalLink, Folder } from "lucide-react";
import { getConfigPaths, type ConfigPaths } from "../../ipc/config";
import { useUpdater } from "../../state/updater";
import { useSettingsStore } from "../../state/settings";
import { useT } from "../../i18n";

export function AboutPanel() {
  const version = import.meta.env.PACKAGE_VERSION;
  const [paths, setPaths] = useState<ConfigPaths | null>(null);
  const t = useT();

  const { status, version: newVersion, notes, progress, error } = useUpdater();
  const autoUpdateCheck = useSettingsStore((s) => s.autoUpdateCheck);

  // Clear stale error state when panel mounts so navigating away and back
  // always starts fresh. The startup check already leaves status=idle; this
  // only cleans up a lingering manual-check failure from a previous visit.
  useEffect(() => {
    if (useUpdater.getState().status === "error") {
      useUpdater.setState({ status: "idle", error: null });
    }
  }, []);

  // Load config paths once on mount. Silently ignore IPC failure — the
  // panel falls back to hiding the paths block rather than showing an
  // error inline, since it's informational chrome not a workflow.
  useEffect(() => {
    let cancelled = false;
    getConfigPaths()
      .then((p) => { if (!cancelled) setPaths(p); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ padding: "20px 24px", color: "var(--text-1)", flex: 1 }}>
      <h3 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 20px" }}>{t("About")}</h3>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <span style={{ color: "var(--accent)", fontFamily: '"JetBrains Mono", var(--font-mono)' }}>&gt;_</span>
        {" "}ShellX <span style={{ color: "var(--text-2)" }}>v{version}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 6 }}>MIT License · Copyright © 2026</div>
      <a
        href="https://github.com/Clarence404/shellx"
        target="_blank" rel="noreferrer"
        style={{
          fontSize: 12, color: "var(--accent)", textDecoration: "none",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        github.com/Clarence404/shellx <ExternalLink size={11} />
      </a>

      {/* ── Update banner (shown when update is available or downloading) ── */}
      {(status === "available" || status === "downloading") && (
        <div style={{
          marginTop: 16, padding: "10px 12px", borderRadius: 6,
          border: "1px solid var(--accent)", background: "rgba(124,92,255,.08)",
          fontSize: 12,
        }}>
          {status === "available" && (
            <>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>
                {t("New version available")}
                {newVersion && <span style={{ color: "var(--text-2)", marginLeft: 6 }}>v{newVersion}</span>}
              </div>
              {notes && (
                <div style={{ color: "var(--text-2)", marginBottom: 8, lineHeight: 1.5 }}>{notes}</div>
              )}
              <button
                onClick={() => void useUpdater.getState().downloadAndInstall()}
                style={{
                  fontSize: 12, padding: "4px 12px", borderRadius: 4,
                  background: "var(--accent)", color: "var(--text-on-accent)",
                  border: "none", cursor: "pointer",
                }}
              >{t("Download & restart")}</button>
            </>
          )}
          {status === "downloading" && (
            <>
              <div style={{ marginBottom: 6 }}>{t("Downloading…")}</div>
              <div style={{ height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 2, background: "var(--accent)",
                  width: `${Math.max(5, progress * 100)}%`,
                  transition: "width 200ms ease",
                }} />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Update error banner ── */}
      {status === "error" && (
        <div style={{
          marginTop: 16, padding: "8px 12px", borderRadius: 6,
          border: "1px solid var(--error)", background: "rgba(243,139,168,.08)",
          fontSize: 12, display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ color: "var(--error)", flex: 1 }}>{t("Update check failed")}{error ? `: ${error}` : ""}</span>
          <button
            onClick={() => void useUpdater.getState().check(false)}
            style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 4,
              border: "1px solid var(--error)", background: "transparent",
              color: "var(--error)", cursor: "pointer",
            }}
          >{t("Retry")}</button>
        </div>
      )}

      {/* ── Check for updates row ── */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          disabled={status === "checking" || status === "downloading"}
          onClick={() => void useUpdater.getState().check(false)}
          style={{
            fontSize: 12, padding: "4px 12px", borderRadius: 4,
            border: "1px solid var(--border)", background: "transparent",
            color: "var(--text-1)", cursor: "pointer",
            opacity: (status === "checking" || status === "downloading") ? 0.5 : 1,
          }}
        >
          {status === "checking" ? t("Checking…") : t("Check for updates")}
        </button>
        {status === "upToDate" && (
          <span style={{ fontSize: 12, color: "var(--text-2)" }}>{t("Up to date")}</span>
        )}
      </div>

      {/* ── Auto-check toggle ── */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 10, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={autoUpdateCheck}
          onChange={(e) => useSettingsStore.getState().setAutoUpdateCheck(e.target.checked)}
        />
        {t("Automatically check for updates")}
      </label>

      {paths && (
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "0.5px solid var(--border)" }}>
          <div style={{
            fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2,
            color: "var(--text-3)", fontWeight: 500, marginBottom: 10,
          }}>Config location</div>
          <PathRow label="Config dir" value={paths.configDir} />
          <PathRow label="hosts.db" value={paths.hostsDb} />
          <PathRow label="settings.json" value={paths.settingsJson} />
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 8, lineHeight: 1.5 }}>
            To customize: set the <code style={{
              fontFamily: '"JetBrains Mono", var(--font-mono)', background: "var(--panel-1)",
              padding: "0 4px", borderRadius: 3,
            }}>SHELLX_CONFIG_DIR</code> environment variable before launching ShellX.
          </div>
        </div>
      )}
    </div>
  );
}

function PathRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "4px 0", fontSize: 12,
    }}>
      <Folder size={12} color="var(--text-3)" />
      <span style={{ color: "var(--text-2)", minWidth: 90 }}>{label}</span>
      <span
        title={value}
        style={{
          fontFamily: '"JetBrains Mono", var(--font-mono)', fontSize: 11,
          color: "var(--text-1)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1,
        }}
      >{value}</span>
    </div>
  );
}

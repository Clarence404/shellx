import { type ReactNode, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, Upload, KeyRound, Network } from "lucide-react";
import { exportBundle, previewBundle, importBundle } from "../../ipc/bundle";
import { useHostsStore } from "../../state/hosts";
import { useSettingsStore } from "../../state/settings";
import type { BundlePreview, ExportSummary, ImportSummary } from "../../types/bundle";
import { useT } from "../../i18n";

// Same three tiers Appearance and Advanced use, so every settings panel
// scales together with the System-font-size slider.
const FS_BODY = "var(--font-ui-size)";
const FS_META = "calc(var(--font-ui-size) - 2px)";
const FS_HEADING = "calc(var(--font-ui-size) + 2px)";
const LIST_WIDTH = 560;

const FILTERS = [{ name: "shellx config", extensions: ["json"] }];

function defaultName() {
  return `shellx-config-${new Date().toISOString().slice(0, 10)}.json`;
}

/**
 * Moving a shellx setup to another machine: one JSON file with the hosts,
 * their tunnel rules and optionally the settings. Passwords and key
 * passphrases stay in this machine's keychain and are never written to
 * it — the panel says so before the export rather than after.
 */
export function BackupPanel() {
  const t = useT();
  const hosts = useHostsStore((s) => s.hosts);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [exported, setExported] = useState<ExportSummary | null>(null);
  const [preview, setPreview] = useState<BundlePreview | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [importSettings, setImportSettings] = useState(false);
  const [imported, setImported] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleExport() {
    setErr(null);
    try {
      const path = await saveDialog({
        title: t("Export configuration"),
        defaultPath: defaultName(),
        filters: FILTERS,
      });
      if (!path) return;
      setBusy(true);
      setExported(await exportBundle(String(path), includeSettings));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleChoose() {
    setErr(null);
    setImported(null);
    try {
      const path = await openDialog({ multiple: false, directory: false, filters: FILTERS });
      if (!path) return;
      setBusy(true);
      const result = await previewBundle(String(path));
      setPreview(result);
      // Anything already here starts unchecked: importing twice should
      // not quietly double every host.
      setChecked(Object.fromEntries(result.rows.map((r) => [r.id, !r.duplicate])));
      setImportSettings(false);
    } catch (e) {
      setPreview(null);
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const selected = (preview?.rows ?? []).filter((r) => checked[r.id]);

  async function handleImport() {
    if (!preview) return;
    setErr(null);
    setBusy(true);
    try {
      const result = await importBundle(
        preview.path,
        selected.map((r) => r.id),
        importSettings && preview.hasSettings,
      );
      setImported(result);
      setPreview(null);
      await useHostsStore.getState().load();
      if (result.settingsApplied) await useSettingsStore.getState().load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "20px 24px", overflowY: "auto", color: "var(--text-1)", flex: 1 }}>
      <h3 style={{ fontSize: FS_HEADING, fontWeight: 500, margin: "0 0 3px" }}>
        {t("Import & export")}
      </h3>
      <div style={{ fontSize: FS_META, color: "var(--text-3)", marginBottom: 16 }}>
        {t("Hosts, tunnel rules and settings in one file · passwords stay in the keychain")}
      </div>

      <div style={{ maxWidth: LIST_WIDTH }}>
        <Section label={t("Export")} first />
        <div style={{ fontSize: FS_BODY, color: "var(--text-2)", marginBottom: 10 }}>
          {hosts.length} {t("hosts")} {t("will be written to the file")}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: FS_BODY, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={includeSettings}
            onChange={(e) => setIncludeSettings(e.target.checked)}
          />
          {t("Include settings (appearance, language, advanced)")}
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleExport()}
          style={buttonStyle}
        >
          <Download size={12} strokeWidth={2} />
          {t("Export to file…")}
        </button>
        {exported && (
          <div style={{ marginTop: 10, fontSize: FS_META, color: "var(--text-2)" }}>
            <div style={{ color: "var(--success)" }}>
              {t("Exported")} {exported.hosts} {t("hosts")} · {exported.tunnels} {t("tunnel rules")}
              {exported.settingsIncluded ? ` · ${t("settings")}` : ""}
            </div>
            <div style={{
              fontFamily: "var(--font-mono, monospace)", color: "var(--text-3)",
              marginTop: 2, overflowWrap: "anywhere",
            }}>{exported.path}</div>
            {exported.secretsLeftBehind > 0 && (
              <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                <KeyRound size={11} strokeWidth={2} />
                {exported.secretsLeftBehind} {t("hosts will ask for their password again")}
              </div>
            )}
          </div>
        )}

        <Section label={t("Import")} />
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleChoose()}
          style={buttonStyle}
        >
          <Upload size={12} strokeWidth={2} />
          {t("Choose a bundle…")}
        </button>

        {preview && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: FS_META, color: "var(--text-3)", marginBottom: 6 }}>
              {t("From shellx")} {preview.appVersion} ·{" "}
              {new Date(preview.exportedAt).toLocaleString()}
            </div>

            {preview.rows.length === 0 ? (
              <div style={{ fontSize: FS_BODY, color: "var(--text-3)" }}>
                {t("This bundle has no hosts in it")}
              </div>
            ) : (
              <>
                <label style={{
                  display: "flex", alignItems: "center", gap: 8, fontSize: FS_META,
                  color: "var(--text-3)", paddingBottom: 6, borderBottom: "1px solid var(--border)",
                }}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selected.length === preview.rows.length}
                    onChange={(e) =>
                      setChecked(Object.fromEntries(preview.rows.map((r) => [r.id, e.target.checked])))
                    }
                  />
                  {selected.length} / {preview.rows.length} {t("selected")}
                </label>

                {preview.rows.map((r) => (
                  <label key={r.id} style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    padding: "8px 0", borderBottom: "1px solid var(--border)",
                    fontSize: FS_BODY, cursor: "pointer",
                  }}>
                    <input
                      type="checkbox"
                      checked={!!checked[r.id]}
                      onChange={(e) => setChecked((c) => ({ ...c, [r.id]: e.target.checked }))}
                      style={{ marginTop: 2 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 600 }}>{r.label}</span>
                        {r.duplicate && <Badge>{t("Already saved")}</Badge>}
                        {r.tunnelCount > 0 && (
                          <Badge><Network size={9} strokeWidth={2.5} /> {r.tunnelCount}</Badge>
                        )}
                        {(r.hasPassword || r.hasPassphrase) && (
                          <Badge><KeyRound size={9} strokeWidth={2.5} /> {t("needs password")}</Badge>
                        )}
                      </div>
                      <div style={{
                        fontSize: FS_META, color: "var(--text-3)", marginTop: 2,
                        fontFamily: "var(--font-mono, monospace)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {r.username}@{r.host}:{r.port}
                      </div>
                    </div>
                  </label>
                ))}
              </>
            )}

            {preview.hasSettings && (
              <label style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: FS_BODY, marginTop: 12,
              }}>
                <input
                  type="checkbox"
                  checked={importSettings}
                  onChange={(e) => setImportSettings(e.target.checked)}
                />
                {t("Also replace my settings with the ones in this file")}
              </label>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                disabled={busy || (selected.length === 0 && !(importSettings && preview.hasSettings))}
                onClick={() => void handleImport()}
                style={{ ...buttonStyle, borderColor: "var(--accent)", background: "var(--accent-fade)" }}
              >
                {busy ? `${t("Importing")}…` : `${t("Import")} ${selected.length || ""}`.trim()}
              </button>
              <button type="button" onClick={() => setPreview(null)} style={buttonStyle}>
                {t("Cancel")}
              </button>
            </div>
          </div>
        )}

        {imported && (
          <div style={{ marginTop: 10, fontSize: FS_META }}>
            <div style={{ color: "var(--success)" }}>
              {t("Imported")} {imported.hostsAdded} {t("hosts")} · {imported.tunnelsAdded}{" "}
              {t("tunnel rules")}
              {imported.settingsApplied ? ` · ${t("settings")}` : ""}
            </div>
            {imported.failures.map((f) => (
              <div key={f} style={{ color: "var(--error)", marginTop: 2 }}>{f}</div>
            ))}
          </div>
        )}

        {err && (
          <div style={{ marginTop: 10, fontSize: FS_META, color: "var(--error)" }}>{err}</div>
        )}
      </div>
    </div>
  );
}

const buttonStyle = {
  padding: "6px 10px", borderRadius: 5,
  background: "var(--panel-1)", color: "var(--text-1)",
  border: "1px solid var(--border-hi)", fontSize: FS_BODY,
  display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
} as const;

function Section({ label, first }: { label: string; first?: boolean }) {
  return (
    <div style={{
      fontSize: FS_META, color: "var(--text-3)", fontWeight: 600,
      textTransform: "uppercase", letterSpacing: 0.4,
      marginTop: first ? 0 : 24, marginBottom: 10,
    }}>{label}</div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span style={{
      fontSize: "calc(var(--font-ui-size) - 3px)", padding: "1px 5px", borderRadius: 4,
      display: "inline-flex", alignItems: "center", gap: 3,
      background: "var(--panel-1)", color: "var(--text-3)",
      border: "1px solid var(--border)",
    }}>{children}</span>
  );
}

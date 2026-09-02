import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useFtpStore } from "../state/ftp";
import { useHostsStore } from "../state/hosts";
import type { HostInfo } from "../types/host";
import { useT } from "../i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Saved SSH hosts, offered as SFTP connections. They come in as separate
 * rows rather than references, so the two lists can be renamed and
 * deleted independently — the price is one address kept in two places,
 * and this dialog is what keeps that from meaning typing it twice.
 *
 * Passwords and key passphrases are copied keychain-to-keychain on the
 * Rust side; nothing secret passes through here.
 */
export function FtpImportHosts({ open, onClose }: Props) {
  const t = useT();
  const savedHosts = useHostsStore((s) => s.hosts);
  const ftpHosts = useFtpStore((s) => s.hosts);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Already here means the same address is already an SFTP row — not a
  // reason to refuse, just a reason to leave it unchecked.
  const existing = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const h of savedHosts) {
      map[h.id] = ftpHosts.some(
        (f) =>
          f.protocol === "sftp" &&
          f.host.toLowerCase() === h.host.toLowerCase() &&
          f.port === h.port &&
          f.username.toLowerCase() === h.username.toLowerCase(),
      );
    }
    return map;
  }, [savedHosts, ftpHosts]);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setChecked(Object.fromEntries(savedHosts.map((h) => [h.id, !existing[h.id]])));
    // Only when the dialog opens: re-deriving on every change would undo
    // the user's ticks as soon as an import lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const selected = savedHosts.filter((h) => checked[h.id]);

  async function handleImport() {
    if (!selected.length) return;
    setBusy(true);
    setErr(null);
    try {
      await useFtpStore.getState().importFromHosts(selected.map((h) => h.id));
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="import saved hosts"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380, maxHeight: "80vh", display: "flex", flexDirection: "column",
          background: "var(--panel-2)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}>
        <div style={{ padding: "16px 18px 10px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{
            fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <Download size={14} strokeWidth={2} />
            {t("Import from saved hosts")}
          </h3>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, lineHeight: 1.6 }}>
            {t("They come in as SFTP connections, with their stored password or key.")}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px" }}>
          {savedHosts.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-3)", padding: "20px 0", textAlign: "center" }}>
              {t("No saved hosts to import")}
            </div>
          ) : (
            savedHosts.map((h: HostInfo) => (
              <label key={h.id} style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "7px 0", borderBottom: "1px solid var(--border)",
                fontSize: 12, cursor: "pointer",
              }}>
                <input
                  type="checkbox"
                  checked={!!checked[h.id]}
                  onChange={(e) => setChecked((c) => ({ ...c, [h.id]: e.target.checked }))}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{h.label}</span>
                    {existing[h.id] && (
                      <span style={{
                        fontSize: 10, padding: "1px 5px", borderRadius: 4,
                        background: "var(--panel-1)", color: "var(--text-3)",
                        border: "1px solid var(--border)",
                      }}>{t("Already here")}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 11, color: "var(--text-3)", marginTop: 2,
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{h.username}@{h.host}:{h.port}</div>
                </div>
              </label>
            ))
          )}
        </div>

        <div style={{
          padding: "12px 18px", borderTop: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {err && <div style={{ fontSize: 11, color: "var(--error)" }}>{err}</div>}
          {/* House rule for dialogs: Cancel left, the primary action right. */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1, height: 28, borderRadius: 5, fontSize: 12,
                border: "1px solid var(--border-hi)", background: "transparent",
                color: "var(--text-2)",
              }}>
              {t("Cancel")}
            </button>
            <button
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() => void handleImport()}
              style={{
                flex: 1, height: 28, borderRadius: 5, border: "none", fontSize: 12,
                fontWeight: 600,
                background: selected.length ? "var(--accent)" : "var(--panel-1)",
                color: selected.length ? "var(--text-on-accent)" : "var(--text-3)",
              }}>
              {busy ? `${t("Importing")}…` : `${t("Import")} ${selected.length || ""}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

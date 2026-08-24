import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, KeyRound, TriangleAlert } from "lucide-react";
import { scanSshConfig } from "../ipc/sshconfig";
import { useHostsStore } from "../state/hosts";
import type { ConfigHost, SkipReason, SshConfigScan } from "../types/sshconfig";
import { useT } from "../i18n";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** A host already saved under the same address is not worth a duplicate. */
function isDuplicate(entry: ConfigHost, saved: { host: string; port: number; username: string }[]) {
  return saved.some(
    (h) =>
      h.host.toLowerCase() === entry.hostName.toLowerCase() &&
      h.port === entry.port &&
      h.username.toLowerCase() === entry.user.toLowerCase(),
  );
}

function reasonText(reason: SkipReason): string {
  switch (reason) {
    case "wildcard": return "pattern, not a machine";
    case "negated": return "exclusion rule";
    case "matchBlock": return "conditional block";
    case "include": return "points at another file";
  }
}

/**
 * Offers the hosts described by `~/.ssh/config` for import, one checkbox
 * per row. Nothing is written until the button at the bottom is pressed,
 * and rows that already exist start unchecked — importing twice should be
 * harmless, so the safe default is to leave those alone.
 */
export function SshConfigImport({ open, onClose }: Props) {
  const t = useT();
  const hosts = useHostsStore((s) => s.hosts);
  const addHost = useHostsStore((s) => s.addHost);
  const [scan, setScan] = useState<SshConfigScan | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const mouseDownInsideRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setScan(null);
    setErr(null);
    setDone(null);
    setBusy(false);
    let cancelled = false;
    scanSshConfig()
      .then((result) => {
        if (cancelled) return;
        setScan(result);
        // Pre-check everything that is not already saved.
        const saved = useHostsStore.getState().hosts;
        setChecked(
          Object.fromEntries(result.hosts.map((h) => [h.alias, !isDuplicate(h, saved)])),
        );
      })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [open]);

  const duplicates = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const h of scan?.hosts ?? []) map[h.alias] = isDuplicate(h, hosts);
    return map;
  }, [scan, hosts]);

  if (!open) return null;

  const selected = (scan?.hosts ?? []).filter((h) => checked[h.alias]);
  const allChecked = !!scan?.hosts.length && selected.length === scan.hosts.length;

  async function handleImport() {
    if (!selected.length) return;
    setBusy(true);
    setErr(null);
    let added = 0;
    const failures: string[] = [];
    for (const entry of selected) {
      try {
        await addHost({
          label: entry.alias,
          host: entry.hostName,
          port: entry.port,
          username: entry.user,
          // A key in the config means publickey auth; without one the host
          // lands as password auth with nothing stored, and the connect
          // dialog asks for the password on first use.
          auth_method: entry.identityFile ? "publickey" : "password",
          key_path: entry.identityFile,
        });
        added++;
      } catch (e) {
        failures.push(`${entry.alias}: ${String(e)}`);
      }
    }
    setBusy(false);
    setDone(added);
    // Every row landed — nothing left to read, so get out of the way.
    if (failures.length) setErr(failures.join("\n"));
    else onClose();
  }

  return (
    <div
      role="dialog"
      aria-label="import ssh config"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
      }}
      onMouseDown={(e) => { mouseDownInsideRef.current = e.target !== e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && !mouseDownInsideRef.current) onClose(); }}
    >
      <div style={{
        background: "var(--panel-2)", borderRadius: 8, border: "1px solid var(--border)",
        width: 520, maxHeight: "80vh", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <FileDown size={14} strokeWidth={2} />
            {t("Import from SSH config")}
          </h3>
          <div style={{
            fontSize: 11, color: "var(--text-3)", marginTop: 4,
            fontFamily: "var(--font-mono, monospace)", overflowWrap: "anywhere",
          }}>
            {scan?.path || "~/.ssh/config"}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          {!scan && !err && (
            <div style={{ fontSize: 12, color: "var(--text-3)", padding: "24px 0", textAlign: "center" }}>
              {t("Reading")}…
            </div>
          )}

          {scan && !scan.exists && (
            <div style={{ fontSize: 12, color: "var(--text-3)", padding: "24px 0", textAlign: "center" }}>
              {t("No SSH config file found")}
            </div>
          )}

          {scan?.exists && scan.hosts.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--text-3)", padding: "24px 0", textAlign: "center" }}>
              {t("No importable hosts in this file")}
            </div>
          )}

          {!!scan?.hosts.length && (
            <>
              <label style={{
                display: "flex", alignItems: "center", gap: 8, fontSize: 11,
                color: "var(--text-3)", paddingBottom: 6, borderBottom: "1px solid var(--border)",
              }}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allChecked}
                  onChange={(e) =>
                    setChecked(Object.fromEntries(scan.hosts.map((h) => [h.alias, e.target.checked])))
                  }
                />
                {selected.length} / {scan.hosts.length} {t("selected")}
              </label>

              {scan.hosts.map((h) => (
                <label
                  key={h.alias}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    padding: "8px 0", borderBottom: "1px solid var(--border)",
                    fontSize: 12, cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!checked[h.alias]}
                    onChange={(e) => setChecked((c) => ({ ...c, [h.alias]: e.target.checked }))}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, color: "var(--text-1)" }}>{h.alias}</span>
                      {duplicates[h.alias] && <Badge tone="muted">{t("Already saved")}</Badge>}
                      {h.identityFile && (
                        <Badge tone="muted"><KeyRound size={9} strokeWidth={2.5} /> {t("key")}</Badge>
                      )}
                      {h.proxyJump && (
                        <Badge tone="warn">
                          <TriangleAlert size={9} strokeWidth={2.5} /> {t("via")} {h.proxyJump}
                        </Badge>
                      )}
                    </div>
                    <div style={{
                      fontSize: 11, color: "var(--text-3)", marginTop: 2,
                      fontFamily: "var(--font-mono, monospace)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {h.user}@{h.hostName}:{h.port}
                      {h.userInferred && ` · ${t("user guessed")}`}
                    </div>
                  </div>
                </label>
              ))}
            </>
          )}

          {!!scan?.skipped.length && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-3)" }}>
                {t("Skipped")} ({scan.skipped.length})
              </div>
              {scan.skipped.map((s, i) => (
                <div key={`${s.pattern}-${i}`} style={{
                  fontSize: 11, color: "var(--text-3)", marginTop: 4,
                  display: "flex", gap: 8, justifyContent: "space-between",
                }}>
                  <span style={{
                    fontFamily: "var(--font-mono, monospace)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{s.pattern}</span>
                  <span style={{ flexShrink: 0 }}>{t(reasonText(s.reason))}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 20px", borderTop: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {done !== null && (
            <div style={{ fontSize: 11, color: "var(--success)" }}>
              {t("Imported")} {done}
            </div>
          )}
          {err && (
            <div style={{ fontSize: 11, color: "var(--error)", whiteSpace: "pre-wrap" }}>{err}</div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: "6px 10px", borderRadius: 5, color: "var(--text-2)" }}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() => void handleImport()}
              style={{
                flex: 1, padding: "6px 10px", borderRadius: 5,
                background: selected.length ? "var(--accent)" : "var(--panel-1)",
                color: selected.length ? "#fff" : "var(--text-3)",
                border: "1px solid var(--border)",
                fontWeight: 600, fontSize: 12,
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? `${t("Importing")}…` : `${t("Import")} ${selected.length || ""}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "muted" | "warn"; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, padding: "1px 5px", borderRadius: 4,
      display: "inline-flex", alignItems: "center", gap: 3,
      background: tone === "warn" ? "var(--warn-fade)" : "var(--panel-1)",
      color: tone === "warn" ? "var(--warn)" : "var(--text-3)",
      border: "1px solid var(--border)",
    }}>
      {children}
    </span>
  );
}

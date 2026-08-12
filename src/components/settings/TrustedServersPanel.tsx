import { useEffect, useState } from "react";
import { hostkeysList, type TrustedHost } from "../../ipc/hostkeys";
import { useT } from "../../i18n";

export function TrustedServersPanel() {
  const t = useT();
  const [rows, setRows] = useState<TrustedHost[] | null>(null);

  useEffect(() => {
    hostkeysList().then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div style={{
      flex: 1, minHeight: 0, padding: "20px 24px", display: "flex", flexDirection: "column",
      gap: 16, overflowY: "auto",
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>
          {t("Known hosts")}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          ~/.ssh/known_hosts · {t("read-only view")}
        </div>
      </div>

      {rows === null && (
        <div style={{ color: "var(--text-3)", fontSize: 12 }}>{t("Loading…")}</div>
      )}
      {rows !== null && rows.length === 0 && (
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-3)", fontSize: 12,
        }}>
          {t("No entries")}
        </div>
      )}
      {rows !== null && rows.length > 0 && (
        // overflowY:auto (NOT hidden): as a shrinkable flex item this list
        // gets squeezed when the window is short — hidden would clip rows
        // with no way to see them; auto shows a scrollbar instead.
        <div style={{
          border: "1px solid var(--border)", borderRadius: 6, overflowY: "auto", minHeight: 60,
        }}>
          {rows.map((r, i) => (
            <div key={`${r.host}-${r.key_type}-${i}`} style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto auto",
              alignItems: "center",
              gap: 12,
              padding: "8px 12px",
              borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
              fontSize: 12,
            }}>
              <span style={{
                color: "var(--text-1)", fontFamily: "monospace",
                minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {r.host}
              </span>
              <span style={{ color: "var(--text-3)", whiteSpace: "nowrap" }}>
                {r.key_type}
              </span>
              <span style={{
                color: "var(--text-2)", fontFamily: "monospace", fontSize: 11,
                maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {r.fingerprint}
              </span>
              <button
                onClick={() => void navigator.clipboard.writeText(r.fingerprint)}
                style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 11,
                  background: "transparent", color: "var(--text-3)",
                  border: "0.5px solid var(--border)", cursor: "pointer",
                }}
              >
                {t("Copy")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: "auto", flexShrink: 0 }}>
        {t("shellx only appends to this file · to remove an entry, edit known_hosts directly")}
      </div>
    </div>
  );
}

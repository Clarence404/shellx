import { TriangleAlert, Clipboard, Check } from "lucide-react";
import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { FailedUnit } from "../../types/monitor";
import { useT } from "../../i18n";

/** Short unit name for a command, e.g. "spring_ruoyi_admin_jar.service". */
function CopyCmd({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { void writeText(cmd); setDone(true); setTimeout(() => setDone(false), 1200); }}
      title={cmd}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11,
        fontFamily: "var(--font-mono)", border: "1px solid var(--border)", borderRadius: 6,
        padding: "5px 9px", color: "var(--text-2)", background: "var(--panel-1)", cursor: "pointer",
        maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >
      {done ? <Check size={12} style={{ color: "var(--success)", flexShrink: 0 }} /> : <Clipboard size={12} style={{ flexShrink: 0 }} />}
      {cmd}
    </button>
  );
}

export function FailedTab({ units }: { units: FailedUnit[] }) {
  const t = useT();
  return (
    <div style={{ padding: "12px 16px 16px" }}>
      <div style={{
        fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)",
        fontWeight: 700, margin: "2px 2px 10px", display: "flex", alignItems: "center", gap: 8,
      }}>
        <TriangleAlert size={13} style={{ color: "var(--error)" }} />
        systemctl --failed · {units.length} {t("failed unit(s)")}
      </div>

      {units.map((u) => (
        <div key={u.unit} style={{
          background: "var(--panel-1)", border: "1px solid var(--error)", borderRadius: 12,
          marginBottom: 10, overflow: "hidden",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border-2, var(--border))" }}>
            <span style={{
              width: 9, height: 9, borderRadius: "50%", background: "var(--error)", flexShrink: 0,
              boxShadow: "0 0 0 3px var(--error-fade)",
            }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis" }}>{u.unit}</span>
            <span style={{ fontSize: 10, color: "#fff", background: "var(--error)", borderRadius: 4, padding: "1px 7px", fontWeight: 600 }}>failed</span>
            {u.since && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>{u.since}</span>}
          </div>

          {(u.result || u.exitStatus) && (
            <div style={{ display: "flex", gap: 24, padding: "10px 14px", flexWrap: "wrap" }}>
              {u.result && <Kv k={t("Result")} v={u.result} red />}
              {u.exitStatus && <Kv k={t("Exit status")} v={u.exitStatus} red />}
            </div>
          )}
          {u.description && (
            <div style={{ padding: "0 14px 10px", fontSize: 11, color: "var(--text-2)" }}>{u.description}</div>
          )}

          <div style={{
            display: "flex", gap: 8, padding: "10px 14px", background: "var(--panel-2)",
            borderTop: "1px solid var(--border-2, var(--border))", flexWrap: "wrap",
          }}>
            <CopyCmd cmd={`journalctl -u ${u.unit} -n 50 --no-pager`} />
            <CopyCmd cmd={`systemctl status ${u.unit}`} />
            <CopyCmd cmd={`systemctl restart ${u.unit}`} />
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10, lineHeight: 1.7 }}>
        {t("Buttons copy the command — paste it in the terminal to investigate or restart. shellx never runs sudo for you.")}
      </div>
    </div>
  );
}

function Kv({ k, v, red }: { k: string; v: string; red?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--text-3)" }}>{k}</div>
      <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 600, color: red ? "var(--error)" : "var(--text-1)" }}>{v}</div>
    </div>
  );
}

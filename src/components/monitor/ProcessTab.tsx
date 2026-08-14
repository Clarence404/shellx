import { Activity } from "lucide-react";
import type { ProcessRow } from "../../types/monitor";
import { useT } from "../../i18n";

interface Props {
  processes: ProcessRow[];
}

export function ProcessTab({ processes }: Props) {
  const t = useT();
  const topCpuPid = processes[0]?.pid;
  const topMemPid = [...processes].sort((a, b) => b.memPct - a.memPct)[0]?.pid;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding: 12,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: "var(--panel-1)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <Activity size={14} style={{ color: "var(--text-2)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
            {t("Process")}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {processes.length} {t("processes · sorted by CPU")}
          </span>
        </div>

        {/* Table */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {processes.length === 0 ? (
            <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>
              {t("Collecting data…")}
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "var(--font-ui-size)",
                tableLayout: "fixed",
              }}
            >
              <colgroup>
                <col style={{ width: "25%" }} />
                <col style={{ width: "25%" }} />
                <col style={{ width: "25%" }} />
                <col style={{ width: "25%" }} />
              </colgroup>
              <thead>
                <tr
                  style={{
                    background: "var(--panel-1)",
                    position: "sticky",
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  {["PID", "CPU %", "MEM %", t("Process")].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "8px 14px",
                        textAlign: "left",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        color: "var(--text-3)",
                        borderBottom: "1px solid var(--border)",
                        fontWeight: 500,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {processes.map((p) => (
                  <tr
                    key={p.pid}
                    style={{
                      borderBottom: "0.5px solid var(--border)",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--panel-2)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                    }}
                  >
                    <td
                      style={{
                        padding: "5px 14px",
                        color: "var(--text-3)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {p.pid}
                    </td>
                    <td
                      style={{
                        padding: "5px 14px",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--text-1)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {p.cpuPct.toFixed(1)}%
                        {p.pid === topCpuPid && p.cpuPct > 0 && (
                          <span
                            style={{
                              fontSize: 9,
                              padding: "1px 5px",
                              borderRadius: 3,
                              background: "var(--accent-fade)",
                              color: "var(--accent)",
                              textTransform: "uppercase",
                              letterSpacing: 0.3,
                            }}
                          >
                            CPU
                          </span>
                        )}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "5px 14px",
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--text-1)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {p.memPct.toFixed(1)}%
                        {p.pid === topMemPid && p.memPct > 0 && (
                          <span
                            style={{
                              fontSize: 9,
                              padding: "1px 5px",
                              borderRadius: 3,
                              background: "rgba(166, 227, 161, 0.16)",
                              color: "var(--success)",
                              textTransform: "uppercase",
                              letterSpacing: 0.3,
                            }}
                          >
                            MEM
                          </span>
                        )}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "5px 14px",
                        color: "var(--text-1)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

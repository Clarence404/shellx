import type { ProcessRow } from "../../types/monitor";

interface Props { processes: ProcessRow[] }

export function ProcessTab({ processes }: Props) {
  if (processes.length === 0) {
    return (
      <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>
        正在采集数据…
      </div>
    );
  }

  const topCpuPid = processes[0]?.pid;
  const topMemPid = [...processes].sort((a, b) => b.memPct - a.memPct)[0]?.pid;

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <table style={{
        width: "100%", borderCollapse: "collapse",
        fontSize: "var(--font-ui-size)", tableLayout: "fixed",
      }}>
        <colgroup>
          <col style={{ width: 64 }} />
          <col style={{ width: 72 }} />
          <col style={{ width: 72 }} />
          <col />
        </colgroup>
        <thead>
          <tr style={{ background: "var(--panel-1)", position: "sticky", top: 0 }}>
            {["PID", "CPU%", "MEM%", "进程"].map((h) => (
              <th key={h} style={{
                padding: "6px 10px", textAlign: "left",
                fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4,
                color: "var(--text-3)", borderBottom: "1px solid var(--border)",
                fontWeight: 500,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {processes.map((p) => (
            <tr key={p.pid} style={{
              borderBottom: "0.5px solid var(--border)",
            }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "var(--border)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <td style={{ padding: "4px 10px", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                {p.pid}
              </td>
              <td style={{ padding: "4px 10px", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {p.cpuPct.toFixed(1)}%
                  {p.pid === topCpuPid && (
                    <span style={{
                      fontSize: 9, padding: "1px 4px", borderRadius: 3,
                      background: "rgba(100,149,237,0.2)", color: "#6495ed",
                      textTransform: "uppercase",
                    }}>CPU</span>
                  )}
                </span>
              </td>
              <td style={{ padding: "4px 10px", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {p.memPct.toFixed(1)}%
                  {p.pid === topMemPid && (
                    <span style={{
                      fontSize: 9, padding: "1px 4px", borderRadius: 3,
                      background: "rgba(76,175,80,0.2)", color: "#4caf50",
                      textTransform: "uppercase",
                    }}>MEM</span>
                  )}
                </span>
              </td>
              <td style={{
                padding: "4px 10px", color: "var(--text-1)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {p.name}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

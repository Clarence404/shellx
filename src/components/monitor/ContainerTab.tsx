import { Boxes } from "lucide-react";
import type { ContainerRow } from "../../types/monitor";
import { fmtBytes } from "./format";
import { useWidthTier } from "./useWidth";
import { useT } from "../../i18n";

function stateColor(state: string, healthy: boolean | null): string {
  if (healthy === false) return "var(--error)";
  if (state === "running") return "var(--success)";
  if (state === "restarting") return "var(--warn)";
  return "var(--text-3)"; // exited / created / paused
}

export function ContainerTab({ containers, loaded }: { containers: ContainerRow[]; loaded: boolean }) {
  const t = useT();
  const [ref, tier] = useWidthTier<HTMLDivElement>();
  const narrow = tier === "narrow";

  // Docker runs on its own loop, so the first time this tab opens the cache
  // may not have filled yet — show a loading state rather than a premature
  // "no containers".
  if (!loaded) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 10, padding: "56px 24px", color: "var(--text-2)",
      }}>
        <span style={{ display: "inline-flex", gap: 4, fontSize: 20, lineHeight: 1, color: "var(--accent)", letterSpacing: 1 }}>
          <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out infinite" }}>·</span>
          <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out 0.2s infinite" }}>·</span>
          <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out 0.4s infinite" }}>·</span>
        </span>
        <div style={{ fontSize: "var(--font-ui-size)", color: "var(--text-1)" }}>{t("Loading containers…")}</div>
        <div style={{ fontSize: "calc(var(--font-ui-size) - 2px)", color: "var(--text-3)" }}>
          {t("Reading docker stats")}
        </div>
      </div>
    );
  }

  const totalCpu = containers.reduce((a, c) => a + c.cpuPct, 0);
  const totalMem = containers.reduce((a, c) => a + c.memUsedBytes, 0);
  const maxCpu = Math.max(1, ...containers.map((c) => c.cpuPct));
  const maxMem = Math.max(1, ...containers.map((c) => c.memUsedBytes));

  return (
    <div ref={ref} style={{ padding: "12px 16px 16px" }}>
      <div style={{
        fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)",
        fontWeight: 700, margin: "2px 2px 8px", display: "flex", alignItems: "center", gap: 8,
      }}>
        <Boxes size={13} /> {t("Running containers")} · {containers.length}
        <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--text-2)", textTransform: "none", letterSpacing: 0, fontSize: 11 }}>
          {t("total")} CPU {totalCpu.toFixed(1)}% · {t("Memory")} {fmtBytes(totalMem)}
        </span>
      </div>

      <div style={{
        background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden",
      }}>
        {containers.length === 0 ? (
          <div style={{ padding: "18px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
            {t("No running containers.")}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th>{t("Container")}</Th>
                <Th w={narrow ? 90 : 150}>CPU</Th>
                <Th w={narrow ? 110 : 180}>{t("Memory")}</Th>
                {!narrow && <Th w={110} right>{t("Network")} ↓↑</Th>}
                {!narrow && <Th w={110} right>{t("Block I/O")} R/W</Th>}
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr key={c.name} style={{ borderTop: "1px solid var(--border-2, var(--border))" }}>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: stateColor(c.state, c.healthy) }} />
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      {c.healthy === true && <Badge color="var(--success)">healthy</Badge>}
                      {c.healthy === false && <Badge color="var(--error)">unhealthy</Badge>}
                      {c.state !== "running" && <Badge color="var(--text-3)">{c.state}</Badge>}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{c.image}</div>
                  </td>
                  <BarCell pct={c.cpuPct} max={maxCpu} color="var(--accent)" text={`${c.cpuPct.toFixed(1)}%`} />
                  <BarCell
                    pct={c.memUsedBytes} max={maxMem}
                    color="color-mix(in srgb, var(--accent) 45%, var(--panel-2))"
                    text={fmtBytes(c.memUsedBytes)}
                    sub={c.memLimitBytes ? ` / ${fmtBytes(c.memLimitBytes)}` : undefined}
                    textStrong
                  />
                  {!narrow && <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{c.netIo || "—"}</td>}
                  {!narrow && <td style={{ ...tdStyle, textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>{c.blockIo || "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const tdStyle: React.CSSProperties = { padding: "8px 14px", fontSize: 12, verticalAlign: "middle" };

function Th({ children, w, right }: { children: React.ReactNode; w?: number; right?: boolean }) {
  return (
    <th style={{
      textAlign: right ? "right" : "left", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase",
      color: "var(--text-3)", fontWeight: 600, padding: "8px 14px",
      borderBottom: "1px solid var(--border)", width: w,
    }}>{children}</th>
  );
}
function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 600, padding: "0 5px", borderRadius: 999,
      border: `1px solid ${color}`, color, background: "color-mix(in srgb, " + color + " 12%, transparent)",
    }}>{children}</span>
  );
}
function BarCell({ pct, max, color, text, sub, textStrong }: {
  pct: number; max: number; color: string; text: string; sub?: string; textStrong?: boolean;
}) {
  return (
    <td style={{ ...tdStyle, position: "relative" }}>
      <div style={{
        position: "absolute", left: 14, right: 14, top: "50%", transform: "translateY(-50%)",
        height: 13, background: "var(--panel-2)", borderRadius: 3, overflow: "hidden",
      }}>
        <div style={{ width: `${(pct / max) * 100}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{
        position: "relative", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
        fontVariantNumeric: "tabular-nums", color: textStrong ? "var(--text-1)" : color,
      }}>{text}{sub && <span style={{ color: "var(--text-3)", fontWeight: 400 }}>{sub}</span>}</span>
    </td>
  );
}

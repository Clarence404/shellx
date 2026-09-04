import type { MonitorSnapshot } from "../../types/monitor";
import { healthColor, loadHealth } from "./format";
import { useT } from "../../i18n";

function gb(b: number): string {
  if (b >= 1_099_511_627_776) return `${(b / 1_099_511_627_776).toFixed(1)} TB`;
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  return `${(b / 1_048_576).toFixed(0)} MB`;
}

/**
 * The one strip of history you get for free: 1/5/15-minute load averages
 * (a real look back over the 15 min before the panel opened), plus the
 * since-boot totals. No server-side collector needed.
 */
export function LoadBand({ latest }: { latest: MonitorSnapshot }) {
  const t = useT();
  const cores = latest.cpu?.corePct.length ?? 1;
  const load = latest.load;
  const sb = latest.sinceBoot;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, padding: "8px 16px",
      background: "var(--panel-1)", borderBottom: "1px solid var(--border)",
      flexWrap: "wrap", flexShrink: 0,
    }}>
      {load && (
        <>
          <span style={{ fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 700 }}>
            {t("Load")}
          </span>
          {([["1m", load.one], ["5m", load.five], ["15m", load.fifteen]] as [string, number][]).map(([w, v]) => (
            <span key={w} style={{ display: "inline-flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontSize: 10, color: "var(--text-3)" }}>{w}</span>
              <span style={{
                fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono)",
                color: healthColor[loadHealth(v, cores)],
              }}>{v.toFixed(2)}</span>
            </span>
          ))}
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>· {cores} {t("cores")}</span>
        </>
      )}
      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-2)" }}>
        {t("Since boot")} ↓<b style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>{gb(sb.netRxTotal)}</b>
        {" "}↑<b style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>{gb(sb.netTxTotal)}</b>
        {" · "}{t("read")} <b style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>{gb(sb.diskReadTotal)}</b>
        {" "}{t("write")} <b style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>{gb(sb.diskWriteTotal)}</b>
        {" · "}{t("avg CPU")} <b style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>{sb.cpuAvgPct.toFixed(1)}%</b>
      </span>
    </div>
  );
}

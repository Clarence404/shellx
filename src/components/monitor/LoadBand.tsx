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
export function LoadBand({ latest, showSinceBoot = true }: { latest: MonitorSnapshot; showSinceBoot?: boolean }) {
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
            {t("System load")}
          </span>
          {([load.one, load.five, load.fifteen]).map((v, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {i > 0 && <span style={{ color: "var(--border)" }}>·</span>}
              <span style={{
                fontSize: 15, fontWeight: 700, fontFamily: "var(--font-mono)",
                color: healthColor[loadHealth(v, cores)],
              }}>{v.toFixed(2)}</span>
            </span>
          ))}
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>
            {t("1 / 5 / 15 min")} · {cores} {t("cores")}（&lt;{cores} {t("not overloaded")}）
          </span>
        </>
      )}
      {showSinceBoot && (
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8, fontSize: 10, color: "var(--text-2)" }}>
        <span style={{ fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 700 }}>{t("Total since boot")}</span>
        <span><Cat>{t("Network")}</Cat> ↓<B>{gb(sb.netRxTotal)}</B> ↑<B>{gb(sb.netTxTotal)}</B></span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span><Cat>{t("Disk")}</Cat> {t("read")}<B>{gb(sb.diskReadTotal)}</B> {t("write")}<B>{gb(sb.diskWriteTotal)}</B></span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span><Cat>CPU</Cat> {t("avg")}<B>{sb.cpuAvgPct.toFixed(1)}%</B></span>
      </span>
      )}
    </div>
  );
}

/** A dim category label ("网络" / "磁盘" / "CPU") before a group of totals. */
function Cat({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--text-3)", fontWeight: 600, marginRight: 3 }}>{children}</span>;
}
/** A monospace, emphasized value inside the since-boot totals. */
function B({ children }: { children: React.ReactNode }) {
  return <b style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>{children}</b>;
}

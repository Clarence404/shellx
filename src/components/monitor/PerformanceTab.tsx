import { Cpu, MemoryStick, Network, HardDrive } from "lucide-react";
import type { MonitorSnapshot } from "../../types/monitor";
import { MetricChart } from "./MetricChart";
import { fmtKb, fmtRate, netRate, series } from "./format";
import { useT } from "../../i18n";

const cardStyle: React.CSSProperties = {
  background: "var(--panel-1)", border: "1px solid var(--border)",
  borderRadius: 12, padding: "14px 16px",
};
const headStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 7, marginBottom: 10,
};

/** Per-core load as a colour-graded grid — compact enough for 8 or 64 cores. */
function CoreHeatmap({ cores }: { cores: number[] }) {
  const t = useT();
  const cols = cores.length <= 8 ? cores.length : cores.length <= 16 ? 8 : 16;
  return (
    <>
      <div style={{
        display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4, marginTop: 10,
      }}>
        {cores.map((v, i) => {
          const f = v / 100;
          const bg = f > 0.66 ? "#3d6cf0" : f > 0.33 ? "#6f97ff" : f > 0.05 ? "#8fb0ff" : "var(--panel-2)";
          const col = f > 0.05 ? "#fff" : "var(--text-3)";
          return (
            <div key={i} title={`C${i} · ${v.toFixed(0)}%`} style={{
              aspectRatio: "1", borderRadius: 4, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 9, fontFamily: "var(--font-mono)",
              fontWeight: 600, background: bg, color: col,
            }}>{Math.round(v)}</div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: "var(--text-3)", textAlign: "center", marginTop: 3 }}>
        C0 — C{cores.length - 1} · {t("per-core load (hover for value)")}
      </div>
    </>
  );
}

export function PerformanceTab({
  snapshots, intervalSecs,
}: {
  snapshots: MonitorSnapshot[];
  intervalSecs: number;
}) {
  const t = useT();
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;
  const mem = latest.memory;
  const net = netRate(latest);
  const io = latest.diskIo;

  const usedKb = mem.usedKb;
  const cachedKb = mem.cachedKb;
  const freeKb = Math.max(0, mem.totalKb - usedKb - cachedKb);
  const pctOf = (kb: number) => mem.totalKb ? (kb / mem.totalKb) * 100 : 0;
  const swapPct = mem.swapTotalKb ? (mem.swapUsedKb / mem.swapTotalKb) * 100 : 0;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
      gap: 12, padding: "12px 16px 16px",
    }}>
      {/* CPU */}
      <div style={cardStyle}>
        <div style={headStyle}>
          <Cpu size={14} style={{ color: "var(--text-2)" }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("CPU usage")}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-2)" }}>
            <b style={{ fontSize: 15, color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>
              {(latest.cpu?.totalPct ?? 0).toFixed(1)}</b>%
          </span>
        </div>
        <MetricChart
          height={74}
          intervalSecs={intervalSecs}
          max={100}
          format={(v) => `${v.toFixed(1)} %`}
          series={[{
            values: series(snapshots, (s) => s.cpu?.totalPct ?? 0),
            color: "var(--accent)", fill: "color-mix(in srgb, var(--accent) 12%, transparent)",
            label: "CPU",
          }]}
        />
        {latest.cpu && latest.cpu.corePct.length > 0 && <CoreHeatmap cores={latest.cpu.corePct} />}
      </div>

      {/* Memory */}
      <div style={cardStyle}>
        <div style={headStyle}>
          <MemoryStick size={14} style={{ color: "var(--text-2)" }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("Memory")}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-2)" }}>
            <b style={{ fontSize: 15, color: "var(--text-1)" }}>{fmtKb(usedKb)}</b> / {fmtKb(mem.totalKb)}
          </span>
        </div>
        <div style={{
          height: 10, borderRadius: 5, overflow: "hidden", display: "flex",
          marginTop: 8, background: "var(--panel-2)",
        }}>
          <div style={{ width: `${pctOf(usedKb)}%`, background: "var(--accent)" }} />
          <div style={{ width: `${pctOf(cachedKb)}%`, background: "color-mix(in srgb, var(--accent) 45%, var(--panel-2))" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-2)", marginTop: 8 }}>
          <span><Dot c="var(--accent)" />{t("Used")} <b style={{ color: "var(--text-1)" }}>{fmtKb(usedKb)}</b></span>
          <span><Dot c="color-mix(in srgb, var(--accent) 45%, var(--panel-2))" />{t("Cache")} <b style={{ color: "var(--text-1)" }}>{fmtKb(cachedKb)}</b></span>
          <span>{t("Free")} <b style={{ color: "var(--text-1)" }}>{fmtKb(freeKb)}</b></span>
        </div>
        <div style={{ ...headStyle, margin: "14px 0 6px" }}>
          <span style={{ fontSize: 11, color: "var(--text-2)", fontWeight: 600 }}>Swap</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-2)" }}>
            <b style={{ fontSize: 12, color: "var(--text-1)" }}>{fmtKb(mem.swapUsedKb)}</b> / {fmtKb(mem.swapTotalKb)}
          </span>
        </div>
        <div style={{ height: 10, borderRadius: 5, overflow: "hidden", background: "var(--panel-2)" }}>
          <div style={{ width: `${swapPct}%`, height: "100%", background: "var(--warn)" }} />
        </div>
      </div>

      {/* Network */}
      <div style={cardStyle}>
        <div style={headStyle}>
          <Network size={14} style={{ color: "var(--text-2)" }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {t("Network")}{latest.network[0] ? ` · ${latest.network.map((n) => n.iface).slice(0, 2).join(", ")}` : ""}
          </span>
        </div>
        <MetricChart
          height={60}
          intervalSecs={intervalSecs}
          format={(v) => fmtRate(v)}
          series={[
            { values: series(snapshots, (s) => netRate(s).rx), color: "var(--success)", label: "rx" },
            { values: series(snapshots, (s) => netRate(s).tx), color: "var(--accent)", label: "tx" },
          ]}
        />
        <DualRate
          a={{ k: t("Download"), v: fmtRate(net.rx), c: "var(--success)", tot: `${t("total")} ↓${fmtBytesTotal(latest.sinceBoot.netRxTotal)}` }}
          b={{ k: t("Upload"), v: fmtRate(net.tx), c: "var(--accent)", tot: `${t("total")} ↑${fmtBytesTotal(latest.sinceBoot.netTxTotal)}` }}
        />
      </div>

      {/* Disk I/O */}
      <div style={cardStyle}>
        <div style={headStyle}>
          <HardDrive size={14} style={{ color: "var(--text-2)" }} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("Disk I/O")}</span>
        </div>
        <MetricChart
          height={60}
          intervalSecs={intervalSecs}
          format={(v) => fmtRate(v)}
          series={[
            { values: series(snapshots, (s) => s.diskIo.readBytesPerSec), color: "var(--warn)", label: "read" },
            { values: series(snapshots, (s) => s.diskIo.writeBytesPerSec), color: "#a06be0", label: "write" },
          ]}
        />
        <DualRate
          a={{ k: t("Read"), v: fmtRate(io.readBytesPerSec), c: "var(--warn)", tot: `${t("total")} ${fmtBytesTotal(latest.sinceBoot.diskReadTotal)}` }}
          b={{ k: t("Write"), v: fmtRate(io.writeBytesPerSec), c: "#a06be0", tot: `${t("total")} ${fmtBytesTotal(latest.sinceBoot.diskWriteTotal)}` }}
        />
      </div>
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: c, marginRight: 4 }} />;
}

function DualRate({ a, b }: {
  a: { k: string; v: string; c: string; tot: string };
  b: { k: string; v: string; c: string; tot: string };
}) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      {[a, b].map((h, i) => (
        <div key={i} style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: "var(--text-3)" }}><Dot c={h.c} />{h.k}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: h.c, fontVariantNumeric: "tabular-nums" }}>{h.v}</div>
          <div style={{ fontSize: 9, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{h.tot}</div>
        </div>
      ))}
    </div>
  );
}

function fmtBytesTotal(b: number): string {
  if (b >= 1_099_511_627_776) return `${(b / 1_099_511_627_776).toFixed(1)} TB`;
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

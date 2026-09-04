import type { MonitorSnapshot } from "../../types/monitor";
import { Sparkline } from "./Sparkline";
import {
  fmtRate, healthOf, healthColor, healthFade, netRate, series,
} from "./format";
import { useT } from "../../i18n";

type SubTab = "performance" | "process" | "disk";

interface KpiDef {
  key: string;
  label: string;
  value: string;
  unit?: string;
  sub: string;
  values: number[];
  color: string;
  badgePct?: number;   // drives the health chip when present
  jump: SubTab;
}

/**
 * The always-visible metric strip. Five tiles — CPU, memory, swap, network,
 * disk I/O — each with a mini trend, so the whole machine reads at a glance
 * without switching sub-tabs. Clicking a tile jumps to its detail view.
 */
export function KpiRow({
  snapshots, onJump,
}: {
  snapshots: MonitorSnapshot[];
  onJump: (t: SubTab) => void;
}) {
  const t = useT();
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;

  const mem = latest.memory;
  const memPct = mem.totalKb ? (mem.usedKb / mem.totalKb) * 100 : 0;
  const swapPct = mem.swapTotalKb ? (mem.swapUsedKb / mem.swapTotalKb) * 100 : 0;
  const net = netRate(latest);
  const io = latest.diskIo;

  const defs: KpiDef[] = [
    {
      key: "cpu", label: "CPU",
      value: (latest.cpu?.totalPct ?? 0).toFixed(1), unit: "%",
      sub: `${latest.cpu?.corePct.length ?? 0} ${t("cores")}`,
      values: series(snapshots, (s) => s.cpu?.totalPct ?? 0),
      color: "var(--accent)", badgePct: latest.cpu?.totalPct ?? 0, jump: "performance",
    },
    {
      key: "mem", label: t("Memory"),
      value: memPct.toFixed(0), unit: "%",
      sub: `${fmtKbShort(mem.usedKb)} / ${fmtKbShort(mem.totalKb)}`,
      values: series(snapshots, (s) => s.memory.totalKb ? (s.memory.usedKb / s.memory.totalKb) * 100 : 0),
      color: "var(--success)", badgePct: memPct, jump: "performance",
    },
    {
      key: "swap", label: "Swap",
      value: swapPct.toFixed(0), unit: "%",
      sub: `${fmtKbShort(mem.swapUsedKb)} / ${fmtKbShort(mem.swapTotalKb)}`,
      values: series(snapshots, (s) => s.memory.swapTotalKb ? (s.memory.swapUsedKb / s.memory.swapTotalKb) * 100 : 0),
      color: "var(--text-3)", jump: "performance",
    },
    {
      key: "net", label: t("Network"),
      value: fmtRateShort(net.rx + net.tx).v, unit: fmtRateShort(net.rx + net.tx).u,
      sub: `↓${fmtRateShort(net.rx).v}${fmtRateShort(net.rx).u} ↑${fmtRateShort(net.tx).v}${fmtRateShort(net.tx).u}`,
      values: series(snapshots, (s) => { const r = netRate(s); return r.rx + r.tx; }),
      color: "var(--accent)", jump: "performance",
    },
    {
      key: "disk", label: t("Disk I/O"),
      value: fmtRateShort(io.readBytesPerSec + io.writeBytesPerSec).v,
      unit: fmtRateShort(io.readBytesPerSec + io.writeBytesPerSec).u,
      sub: `R ${fmtRateShort(io.readBytesPerSec).v} · W ${fmtRateShort(io.writeBytesPerSec).v}`,
      values: series(snapshots, (s) => s.diskIo.readBytesPerSec + s.diskIo.writeBytesPerSec),
      color: "var(--warn)", jump: "disk",
    },
  ];

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      gap: 10, padding: "14px 16px 4px", flexShrink: 0,
    }}>
      {defs.map((d) => {
        const health = d.badgePct != null ? healthOf(d.badgePct) : null;
        return (
          <button
            key={d.key}
            onClick={() => onJump(d.jump)}
            title={fmtRate === fmtRate ? undefined : undefined}
            style={{
              position: "relative", overflow: "hidden", textAlign: "left",
              background: "var(--panel-1)", border: "1px solid var(--border)",
              borderRadius: 10, padding: "11px 12px 8px", cursor: "pointer",
            }}
          >
            <div style={{
              fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase",
              color: "var(--text-3)", fontWeight: 600,
            }}>{d.label}</div>
            <div style={{
              fontSize: 22, fontWeight: 700, letterSpacing: -0.5,
              color: "var(--text-1)", fontVariantNumeric: "tabular-nums",
            }}>
              {d.value}<small style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", marginLeft: 1 }}>{d.unit}</small>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{d.sub}</div>
            {health && (
              <span style={{
                position: "absolute", top: 10, right: 10, fontSize: 9, fontWeight: 600,
                padding: "1px 6px", borderRadius: 999,
                background: healthFade[health], color: healthColor[health],
              }}>{health === "ok" ? t("Healthy") : health === "warn" ? t("Busy") : t("High")}</span>
            )}
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 24, opacity: 0.4 }}>
              <Sparkline data={d.values} color={d.color} height={24} width={120} fillContainer />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function fmtKbShort(kb: number): string {
  const b = kb * 1024;
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)}G`;
  if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(0)}M`;
  return `${(b / 1024).toFixed(0)}K`;
}
function fmtRateShort(bps: number): { v: string; u: string } {
  if (bps >= 1_048_576) return { v: (bps / 1_048_576).toFixed(1), u: "M/s" };
  if (bps >= 1024) return { v: (bps / 1024).toFixed(0), u: "K/s" };
  return { v: `${Math.round(bps)}`, u: "B/s" };
}

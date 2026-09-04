import type { MonitorSnapshot, DiskMount } from "../../types/monitor";
import { MetricChart } from "./MetricChart";
import { fmtRate, healthOf, healthColor, series } from "./format";
import { useT } from "../../i18n";

const sectStyle: React.CSSProperties = {
  fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase",
  color: "var(--text-3)", fontWeight: 700, margin: "2px 2px 8px",
};
const cardStyle: React.CSSProperties = {
  background: "var(--panel-1)", border: "1px solid var(--border)", borderRadius: 12,
};

function gb(mb: number): string {
  if (mb >= 1_048_576) return `${(mb / 1_048_576).toFixed(1)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(0)} GB`;
  return `${mb} MB`;
}

function FsRow({ d }: { d: DiskMount }) {
  const t = useT();
  const health = healthOf(d.usePct);
  const color = healthColor[health];
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
      borderBottom: "1px solid var(--border)",
    }}>
      <div style={{ minWidth: 140, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, fontFamily: "var(--font-mono)" }}>{d.target}</div>
      </div>
      <div style={{ flex: 1, minWidth: 60, height: 12, background: "var(--panel-2)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${d.usePct}%`, height: "100%", background: color, borderRadius: 6 }} />
      </div>
      <div style={{
        minWidth: 44, textAlign: "right", fontSize: 14, fontWeight: 700,
        fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", color,
      }}>{d.usePct}%</div>
      <div style={{ minWidth: 170, textAlign: "right", fontSize: 11, color: "var(--text-2)" }}>
        <b style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)" }}>{gb(d.usedMb)}</b> / {gb(d.sizeMb)}
        · {t("free")} {gb(d.availMb)}
      </div>
    </div>
  );
}

export function DiskTab({
  snapshots, intervalSecs,
}: {
  snapshots: MonitorSnapshot[];
  intervalSecs: number;
}) {
  const t = useT();
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;
  const io = latest.diskIo;

  return (
    <div style={{ padding: "12px 16px 16px" }}>
      <div style={sectStyle}>{t("Filesystem usage")}</div>
      <div style={{ ...cardStyle, marginBottom: 12, overflow: "hidden" }}>
        {latest.disks.length === 0 ? (
          <div style={{ padding: "18px", textAlign: "center", color: "var(--text-3)", fontSize: 12 }}>
            {t("No mounted filesystems reported.")}
          </div>
        ) : latest.disks.map((d, i) => (
          <div key={d.target} style={i === latest.disks.length - 1 ? { } : {}}>
            <FsRow d={d} />
          </div>
        ))}
      </div>

      <div style={sectStyle}>{t("Disk I/O")}</div>
      <div style={{ ...cardStyle, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{t("Throughput")}</span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-2)" }}>
            {t("total")} <b style={{ color: "var(--text-1)" }}>{fmtRate(io.readBytesPerSec + io.writeBytesPerSec)}</b>
          </span>
        </div>
        <MetricChart
          height={74}
          intervalSecs={intervalSecs}
          format={(v) => fmtRate(v)}
          series={[
            { values: series(snapshots, (s) => s.diskIo.readBytesPerSec), color: "var(--warn)", label: "read" },
            { values: series(snapshots, (s) => s.diskIo.writeBytesPerSec), color: "#a06be0", label: "write" },
          ]}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Rate k={t("Read")} v={fmtRate(io.readBytesPerSec)} c="var(--warn)" tot={`${t("total")} ${gbBytes(latest.sinceBoot.diskReadTotal)}`} />
          <Rate k={t("Write")} v={fmtRate(io.writeBytesPerSec)} c="#a06be0" tot={`${t("total")} ${gbBytes(latest.sinceBoot.diskWriteTotal)}`} />
        </div>
      </div>
    </div>
  );
}

function Rate({ k, v, c, tot }: { k: string; v: string; c: string; tot: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, color: "var(--text-3)" }}>
        <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: c, marginRight: 4 }} />{k}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: c, fontVariantNumeric: "tabular-nums" }}>{v}</div>
      <div style={{ fontSize: 9, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>{tot}</div>
    </div>
  );
}
function gbBytes(b: number): string {
  if (b >= 1_099_511_627_776) return `${(b / 1_099_511_627_776).toFixed(1)} TB`;
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  return `${(b / 1_048_576).toFixed(0)} MB`;
}

import { useState } from "react";
import { Cpu, MemoryStick, Network, HardDrive, ChevronUp, ChevronDown } from "lucide-react";
import type { MonitorSnapshot, DiskIo } from "../../types/monitor";
import { Sparkline } from "./Sparkline";
import { useT } from "../../i18n";

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB/s`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB/s`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB/s`;
  return `${n} B/s`;
}

function fmtKb(kb: number): string {
  if (kb >= 1_073_741_824) return `${(kb / 1_073_741_824).toFixed(1)} TB`;
  if (kb >= 1_048_576) return `${(kb / 1_048_576).toFixed(1)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

type Status = "ok" | "warn" | "bad";

function statusFor(pct: number): Status {
  if (pct >= 85) return "bad";
  if (pct >= 60) return "warn";
  return "ok";
}

const STATUS_META: Record<Status, { key: string; color: string; bg: string }> = {
  ok:   { key: "Healthy",  color: "var(--success)", bg: "rgba(166, 227, 161, 0.14)" },
  warn: { key: "Warning",  color: "var(--warn)",    bg: "rgba(242, 200, 162, 0.16)" },
  bad:  { key: "Critical", color: "var(--error)",   bg: "rgba(242, 135, 121, 0.16)" },
};

function StatusBadge({ status }: { status: Status }) {
  const t = useT();
  const m = STATUS_META[status];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        color: m.color,
        background: m.bg,
        padding: "2px 10px",
        borderRadius: 10,
        flexShrink: 0,
        lineHeight: 1.5,
      }}
    >
      {t(m.key)}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--panel-1)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

function CardHead({
  icon,
  title,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <span style={{ color: "var(--text-2)", display: "inline-flex" }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", letterSpacing: 0.2 }}>
        {title}
      </span>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

function BigPercent({ value, meta }: { value: string; meta?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 4, flexShrink: 0 }}>
      <span
        style={{
          fontSize: 36,
          fontWeight: 300,
          letterSpacing: -0.5,
          color: "var(--text-1)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 13, color: "var(--text-2)", marginLeft: 2 }}>%</span>
      {meta && (
        <>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>{meta}</span>
        </>
      )}
    </div>
  );
}

function DualRate({
  aLabel,
  aValue,
  bLabel,
  bValue,
}: {
  aLabel: string;
  aValue: string;
  bLabel: string;
  bValue: string;
}) {
  return (
    <div style={{ display: "flex", gap: 32, flexShrink: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 3 }}>{aLabel}</div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 300,
            color: "var(--text-1)",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {aValue}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 3 }}>{bLabel}</div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 300,
            color: "var(--text-1)",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {bValue}
        </div>
      </div>
    </div>
  );
}

function Legend({
  aColor,
  aLabel,
  bColor,
  bLabel,
}: {
  aColor: string;
  aLabel: string;
  bColor: string;
  bLabel: string;
}) {
  return (
    <div style={{ display: "flex", gap: 14, fontSize: 10, color: "var(--text-3)", alignItems: "center" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 10, height: 2, background: aColor, borderRadius: 1 }} />
        {aLabel}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 10, height: 2, background: bColor, borderRadius: 1 }} />
        {bLabel}
      </span>
    </div>
  );
}

interface Props {
  snapshots: MonitorSnapshot[];
  diskIo: DiskIo;
}

export function PerformanceTab({ snapshots, diskIo }: Props) {
  const t = useT();
  const [coreExpanded, setCoreExpanded] = useState(true);

  const latest = snapshots[snapshots.length - 1];
  if (!latest) {
    return (
      <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>{t("Collecting data…")}</div>
    );
  }

  // CPU
  const cpuPct = latest.cpu?.totalPct ?? 0;
  const cpuCores = latest.cpu?.corePct ?? [];
  const cpuAvg =
    cpuCores.length > 0 ? cpuCores.reduce((a, v) => a + v, 0) / cpuCores.length : 0;
  const cpuMaxIdx =
    cpuCores.length > 0
      ? cpuCores.reduce((mx, v, i) => (v > cpuCores[mx] ? i : mx), 0)
      : -1;
  const cpuMinIdx =
    cpuCores.length > 0
      ? cpuCores.reduce((mn, v, i) => (v < cpuCores[mn] ? i : mn), 0)
      : -1;
  const cpuHistory = snapshots.map((s) => s.cpu?.totalPct ?? 0);

  // Memory
  const memPct =
    latest.memory.totalKb > 0 ? (latest.memory.usedKb / latest.memory.totalKb) * 100 : 0;
  const memHistory = snapshots.map((s) =>
    s.memory.totalKb > 0 ? (s.memory.usedKb / s.memory.totalKb) * 100 : 0
  );

  // Network — aggregated across all interfaces
  const rxTotal = latest.network.reduce((a, n) => a + n.rxBytesPerSec, 0);
  const txTotal = latest.network.reduce((a, n) => a + n.txBytesPerSec, 0);
  const rxHistory = snapshots.map((s) => s.network.reduce((a, n) => a + n.rxBytesPerSec, 0));
  const txHistory = snapshots.map((s) => s.network.reduce((a, n) => a + n.txBytesPerSec, 0));
  const netMax = Math.max(...rxHistory, ...txHistory, 1);

  // Disk I/O
  const ioReadHistory = snapshots.map((s) => s.diskIo.readBytesPerSec);
  const ioWriteHistory = snapshots.map((s) => s.diskIo.writeBytesPerSec);
  const ioMax = Math.max(...ioReadHistory, ...ioWriteHistory, 1);

  return (
    <div
      style={{
        // No scrolling here — MonitorPanel is the one scroll container.
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* CPU */}
      <Card>
        <CardHead
          icon={<Cpu size={14} />}
          title={t("CPU usage (overall)")}
          right={<StatusBadge status={statusFor(cpuPct)} />}
        />
        <BigPercent
          value={fmt(cpuPct)}
          meta={cpuCores.length > 0 ? `${cpuCores.length} ${t("cores · avg")} ${fmt(cpuAvg)}%` : undefined}
        />
        <div style={{ height: 72 }}>
          <Sparkline
            data={cpuHistory}
            color="var(--accent)"
            fill="var(--accent-fade)"
            fillContainer
          />
        </div>

        {cpuCores.length > 0 && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--text-3)",
                marginTop: 2,
              }}
            >
              <span>{t("Per-core usage")}</span>
              {cpuMaxIdx >= 0 && cpuMinIdx >= 0 && (
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  max C{cpuMaxIdx} {fmt(cpuCores[cpuMaxIdx])}% · min C{cpuMinIdx}{" "}
                  {fmt(cpuCores[cpuMinIdx])}%
                </span>
              )}
            </div>
            {coreExpanded && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {cpuCores.map((pct, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-3)",
                        width: 22,
                        flexShrink: 0,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      C{i}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 4,
                        background: "var(--border)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct.toFixed(1)}%`,
                          height: "100%",
                          background: "var(--accent)",
                          transition: "width 0.5s ease",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-2)",
                        width: 36,
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                      }}
                    >
                      {fmt(pct)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setCoreExpanded(!coreExpanded)}
              style={{
                alignSelf: "center",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--text-3)",
                fontSize: 11,
                padding: "2px 10px",
              }}
            >
              {coreExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {coreExpanded ? t("Collapse") : t("Expand")}
            </button>
          </>
        )}
      </Card>

      {/* Memory */}
      <Card>
        <CardHead
          icon={<MemoryStick size={14} />}
          title={t("Memory usage")}
          right={
            <span
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtKb(latest.memory.usedKb)} / {fmtKb(latest.memory.totalKb)}
            </span>
          }
        />
        <BigPercent value={fmt(memPct)} />
        <div style={{ height: 72 }}>
          <Sparkline
            data={memHistory}
            color="var(--success)"
            fill="rgba(166, 227, 161, 0.16)"
            fillContainer
          />
        </div>
        {latest.memory.swapTotalKb > 0 && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>Swap</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {fmtKb(latest.memory.swapUsedKb)} / {fmtKb(latest.memory.swapTotalKb)}
            </span>
          </div>
        )}
      </Card>

      {/* Network */}
      <Card>
        <CardHead
          icon={<Network size={14} />}
          title={t("Network")}
          right={
            latest.network.length > 0 && (
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                {latest.network.length} {t("interfaces")}
              </span>
            )
          }
        />
        <DualRate
          aLabel={`↓ ${t("Down")}`}
          aValue={fmtBytes(rxTotal)}
          bLabel={`↑ ${t("Up")}`}
          bValue={fmtBytes(txTotal)}
        />
        <div style={{ position: "relative", height: 72 }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <Sparkline
              data={rxHistory}
              color="var(--accent)"
              fill="var(--accent-fade)"
              fillContainer
              max={netMax}
            />
          </div>
          <div style={{ position: "absolute", inset: 0 }}>
            <Sparkline data={txHistory} color="var(--error)" fillContainer max={netMax} />
          </div>
        </div>
        <Legend aColor="var(--accent)" aLabel={t("Down")} bColor="var(--error)" bLabel={t("Up")} />
      </Card>

      {/* Disk I/O */}
      <Card>
        <CardHead icon={<HardDrive size={14} />} title={t("Disk I/O")} />
        <DualRate
          aLabel={t("Read")}
          aValue={fmtBytes(diskIo.readBytesPerSec)}
          bLabel={t("Write")}
          bValue={fmtBytes(diskIo.writeBytesPerSec)}
        />
        <div style={{ position: "relative", height: 72 }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <Sparkline
              data={ioReadHistory}
              color="var(--accent)"
              fill="var(--accent-fade)"
              fillContainer
              max={ioMax}
            />
          </div>
          <div style={{ position: "absolute", inset: 0 }}>
            <Sparkline data={ioWriteHistory} color="var(--error)" fillContainer max={ioMax} />
          </div>
        </div>
        <Legend aColor="var(--accent)" aLabel={t("Read")} bColor="var(--error)" bLabel={t("Write")} />
      </Card>
    </div>
  );
}

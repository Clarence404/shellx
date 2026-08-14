import { HardDrive, Activity } from "lucide-react";
import type { MonitorSnapshot, DiskMount } from "../../types/monitor";
import { Sparkline } from "./Sparkline";
import { useT } from "../../i18n";

function fmtMb(mb: number): string {
  if (mb >= 1_048_576) return `${(mb / 1_048_576).toFixed(1)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB/s`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB/s`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB/s`;
  return `${n} B/s`;
}

function diskColor(pct: number): string {
  if (pct >= 85) return "var(--error)";
  if (pct >= 60) return "var(--warn)";
  return "var(--success)";
}

interface Props {
  disks: DiskMount[];
  diskIo: MonitorSnapshot["diskIo"];
  snapshots: MonitorSnapshot[];
}

export function DiskTab({ disks, diskIo, snapshots }: Props) {
  const t = useT();
  const readHistory = snapshots.map((s) => s.diskIo.readBytesPerSec);
  const writeHistory = snapshots.map((s) => s.diskIo.writeBytesPerSec);
  const ioMax = Math.max(...readHistory, ...writeHistory, 1);

  const totalMb = disks.reduce((a, d) => a + d.sizeMb, 0);
  const usedMb  = disks.reduce((a, d) => a + d.usedMb, 0);
  const overallPct = totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflowY: "auto",
      }}
    >
      {/* Partitions — natural height; outer DiskTab scrolls when needed */}
      <div
        style={{
          flexShrink: 0,
          background: "var(--panel-1)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
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
          <HardDrive size={14} style={{ color: "var(--text-2)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
            {t("Partitions")}
          </span>
          <div style={{ flex: 1 }} />
          {disks.length > 0 && (
            <span
              style={{
                fontSize: 11,
                color: "var(--text-3)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmtMb(usedMb)} / {fmtMb(totalMb)} · {overallPct}%
            </span>
          )}
        </div>

        <div>
          {disks.length === 0 ? (
            <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>
              {t("Collecting data…")}
            </div>
          ) : (
            disks.map((d) => (
              <div
                key={d.target}
                style={{
                  padding: "10px 16px",
                  borderBottom: "0.5px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: "var(--font-ui-size)",
                      color: "var(--text-1)",
                      fontFamily: "var(--font-mono)",
                    }}
                    title={d.target}
                  >
                    {d.target}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-3)",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtMb(d.usedMb)} / {fmtMb(d.sizeMb)} · {t("Avail")} {fmtMb(d.availMb)}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: diskColor(d.usePct),
                      fontVariantNumeric: "tabular-nums",
                      width: 42,
                      textAlign: "right",
                    }}
                  >
                    {d.usePct}%
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    background: "var(--border)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${d.usePct}%`,
                      height: "100%",
                      background: diskColor(d.usePct),
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Disk I/O — fixed height at bottom */}
      <div
        style={{
          background: "var(--panel-1)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={14} style={{ color: "var(--text-2)" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)" }}>
            {t("Disk I/O")}
          </span>
        </div>

        <div style={{ display: "flex", gap: 32 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 3 }}>
              {t("Read")}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 300,
                color: "var(--text-1)",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {fmtBytes(diskIo.readBytesPerSec)}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 3 }}>
              {t("Write")}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 300,
                color: "var(--text-1)",
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {fmtBytes(diskIo.writeBytesPerSec)}
            </div>
          </div>
        </div>

        <div style={{ position: "relative", height: 48 }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <Sparkline
              data={readHistory}
              color="var(--accent)"
              fill="var(--accent-fade)"
              fillContainer
              max={ioMax}
            />
          </div>
          <div style={{ position: "absolute", inset: 0 }}>
            <Sparkline data={writeHistory} color="var(--error)" fillContainer max={ioMax} />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 14,
            fontSize: 10,
            color: "var(--text-3)",
            alignItems: "center",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 2, background: "var(--accent)", borderRadius: 1 }} />
            {t("Read")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 2, background: "var(--error)", borderRadius: 1 }} />
            {t("Write")}
          </span>
        </div>
      </div>
    </div>
  );
}

import type { MonitorSnapshot, DiskMount } from "../../types/monitor";
import { Sparkline } from "./Sparkline";

function fmtMb(mb: number): string {
  if (mb >= 1_000_000) return `${(mb / 1_000_000).toFixed(1)} TB`;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb} MB`;
}

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB/s`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB/s`;
  return `${n} B/s`;
}

function diskColor(pct: number): string {
  if (pct >= 80) return "#e06c75";
  if (pct >= 60) return "#e5c07b";
  return "#4caf50";
}

interface Props {
  disks: DiskMount[];
  diskIo: MonitorSnapshot["diskIo"];
  snapshots: MonitorSnapshot[];
}

export function DiskTab({ disks, diskIo, snapshots }: Props) {
  const readHistory = snapshots.map((s) => s.diskIo.readBytesPerSec);
  const writeHistory = snapshots.map((s) => s.diskIo.writeBytesPerSec);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Mount points */}
      <div style={{
        background: "var(--panel-1)", border: "1px solid var(--border)",
        borderRadius: 6, overflow: "hidden",
      }}>
        <div style={{
          padding: "8px 14px 6px",
          fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
          color: "var(--text-3)", borderBottom: "1px solid var(--border)",
        }}>
          挂载点
        </div>
        {disks.length === 0 ? (
          <div style={{ padding: "12px 14px", color: "var(--text-3)", fontSize: 13 }}>正在采集数据…</div>
        ) : (
          disks.map((d) => (
            <div key={d.target} style={{
              padding: "8px 14px",
              borderBottom: "0.5px solid var(--border)",
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{ width: 120, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap", fontSize: "var(--font-ui-size)", color: "var(--text-1)" }}>
                {d.target}
              </div>
              <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 3 }}>
                <div style={{
                  width: `${d.usePct}%`, height: "100%",
                  background: diskColor(d.usePct), borderRadius: 3,
                  transition: "width 0.5s ease",
                }} />
              </div>
              <span style={{
                width: 36, textAlign: "right", flexShrink: 0,
                fontSize: "var(--font-ui-size)", color: "var(--text-2)",
                fontVariantNumeric: "tabular-nums",
              }}>
                {d.usePct}%
              </span>
              <span style={{
                flexShrink: 0, fontSize: "var(--font-ui-size)", color: "var(--text-3)",
                fontVariantNumeric: "tabular-nums",
              }}>
                {fmtMb(d.usedMb)} / {fmtMb(d.sizeMb)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Disk I/O */}
      <div style={{
        background: "var(--panel-1)", border: "1px solid var(--border)",
        borderRadius: 6, padding: "12px 14px",
      }}>
        <div style={{
          fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5,
          color: "var(--text-3)", marginBottom: 10,
        }}>
          磁盘 I/O
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>读取</div>
            <div style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-1)",
              fontSize: 16, marginBottom: 6 }}>
              {fmtBytes(diskIo.readBytesPerSec)}
            </div>
            <Sparkline data={readHistory} color="#6fa8dc" fill="rgba(111,168,220,0.15)" height={32} width={100} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>写入</div>
            <div style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-1)",
              fontSize: 16, marginBottom: 6 }}>
              {fmtBytes(diskIo.writeBytesPerSec)}
            </div>
            <Sparkline data={writeHistory} color="#e06c75" fill="rgba(224,108,117,0.15)" height={32} width={100} />
          </div>
        </div>
      </div>
    </div>
  );
}

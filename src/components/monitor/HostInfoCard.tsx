import type { SystemInfo } from "../../types/monitor";

function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${mins} 分`;
  return `${mins} 分钟`;
}

interface Props { system: SystemInfo }

export function HostInfoCard({ system }: Props) {
  return (
    <div style={{
      padding: "10px 14px",
      borderBottom: "1px solid var(--border)",
      display: "flex", gap: 24,
      fontSize: "var(--font-ui-size)",
      color: "var(--text-2)",
      background: "var(--panel-1)",
    }}>
      <InfoPair label="主机名" value={system.hostname || "—"} />
      <InfoPair label="系统" value={system.os ? `${system.os} ${system.kernel}` : "—"} />
      <InfoPair label="架构" value={system.arch || "—"} />
      <InfoPair label="运行时间" value={system.uptimeSecs > 0 ? formatUptime(system.uptimeSecs) : "—"} />
    </div>
  );
}

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: "var(--text-3)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </span>
      <div style={{ color: "var(--text-1)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

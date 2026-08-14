import type { MonitorSnapshot } from "../../types/monitor";
import { Sparkline } from "./Sparkline";

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
  if (kb >= 1_048_576) return `${(kb / 1_048_576).toFixed(1)} TB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} GB`;
  return `${kb} MB`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--panel-1)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-3)" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

interface Props { snapshots: MonitorSnapshot[] }

export function PerformanceTab({ snapshots }: Props) {
  const latest = snapshots[snapshots.length - 1];
  if (!latest) {
    return (
      <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>
        正在采集数据…
      </div>
    );
  }

  const cpuHistory = snapshots.map((s) => s.cpu?.totalPct ?? 0);
  const memPct = latest.memory.totalKb > 0
    ? (latest.memory.usedKb / latest.memory.totalKb) * 100 : 0;
  const memHistory = snapshots.map((s) =>
    s.memory.totalKb > 0 ? (s.memory.usedKb / s.memory.totalKb) * 100 : 0
  );

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", flex: 1 }}>
      {/* CPU */}
      <Card title="CPU">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          <span style={{ fontSize: 28, fontVariantNumeric: "tabular-nums", color: "var(--text-1)" }}>
            {latest.cpu ? `${fmt(latest.cpu.totalPct)}%` : "—"}
          </span>
          <Sparkline data={cpuHistory} color="var(--accent)" fill="rgba(100,149,237,0.15)" height={40} width={120} />
        </div>
        {latest.cpu && latest.cpu.corePct.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {latest.cpu.corePct.slice(0, 8).map((pct, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 10, color: "var(--text-3)", width: 32, flexShrink: 0 }}>
                  CPU{i}
                </span>
                <div style={{ flex: 1, height: 4, background: "var(--border)", borderRadius: 2 }}>
                  <div style={{
                    width: `${pct.toFixed(1)}%`, height: "100%",
                    background: "var(--accent)", borderRadius: 2,
                    transition: "width 0.5s ease",
                  }} />
                </div>
                <span style={{ fontSize: 10, color: "var(--text-2)", width: 36, textAlign: "right",
                  fontVariantNumeric: "tabular-nums" }}>
                  {fmt(pct)}%
                </span>
              </div>
            ))}
            {latest.cpu.corePct.length > 8 && (
              <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                +{latest.cpu.corePct.length - 8} 核
              </span>
            )}
          </div>
        )}
      </Card>

      {/* Memory */}
      <Card title="内存">
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
          <span style={{ fontSize: 28, fontVariantNumeric: "tabular-nums", color: "var(--text-1)" }}>
            {fmt(memPct)}%
          </span>
          <Sparkline data={memHistory} color="#4caf50" fill="rgba(76,175,80,0.15)" height={40} width={120} />
        </div>
        <div style={{ height: 6, background: "var(--border)", borderRadius: 3 }}>
          <div style={{
            width: `${memPct.toFixed(1)}%`, height: "100%",
            background: "#4caf50", borderRadius: 3, transition: "width 0.5s ease",
          }} />
        </div>
        <div style={{ fontSize: "var(--font-ui-size)", color: "var(--text-2)", display: "flex", gap: 16 }}>
          <span>已用 {fmtKb(latest.memory.usedKb)}</span>
          <span>共 {fmtKb(latest.memory.totalKb)}</span>
          {latest.memory.swapTotalKb > 0 && (
            <span style={{ color: "var(--text-3)" }}>
              Swap {fmtKb(latest.memory.swapUsedKb)}/{fmtKb(latest.memory.swapTotalKb)}
            </span>
          )}
        </div>
      </Card>

      {/* Network */}
      {latest.network.length > 0 && (
        <Card title="网络">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {latest.network.map((iface) => {
              const rxHistory = snapshots.map((s) =>
                s.network.find((n) => n.iface === iface.iface)?.rxBytesPerSec ?? 0
              );
              const txHistory = snapshots.map((s) =>
                s.network.find((n) => n.iface === iface.iface)?.txBytesPerSec ?? 0
              );
              return (
                <div key={iface.iface}>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>{iface.iface}</div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-3)" }}>↓ 接收</div>
                      <div style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-1)" }}>
                        {fmtBytes(iface.rxBytesPerSec)}
                      </div>
                      <Sparkline data={rxHistory} color="#6fa8dc" fill="rgba(111,168,220,0.15)" height={24} width={80} />
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: "var(--text-3)" }}>↑ 发送</div>
                      <div style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-1)" }}>
                        {fmtBytes(iface.txBytesPerSec)}
                      </div>
                      <Sparkline data={txHistory} color="#e06c75" fill="rgba(224,108,117,0.15)" height={24} width={80} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

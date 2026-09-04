import { useEffect, useState, useRef } from "react";
import { ShieldAlert, Server } from "lucide-react";
import { useMonitorStore } from "../state/monitor";
import { startMonitor, stopMonitor, onMonitorSnapshot, onMonitorUnsupported } from "../ipc/monitor";
import { ActivitySwitcher } from "./paneChrome";
import { KpiRow } from "./monitor/KpiRow";
import { LoadBand } from "./monitor/LoadBand";
import { PerformanceTab } from "./monitor/PerformanceTab";
import { ProcessTab } from "./monitor/ProcessTab";
import { DiskTab } from "./monitor/DiskTab";
import { ContainerTab } from "./monitor/ContainerTab";
import { FailedTab } from "./monitor/FailedTab";
import { fmtKb, fmtUptime } from "./monitor/format";
import { useWidthTier, type WidthTier } from "./monitor/useWidth";
import { TriangleAlert } from "lucide-react";
import { useT } from "../i18n";

type SubTab = "performance" | "process" | "disk" | "container" | "failed";

const INTERVALS = [1, 2, 5, 10, 30] as const;
type IntervalSecs = typeof INTERVALS[number];


function HostStrip({ system, memory, tier, switcher }: {
  system?: { hostname: string; os: string; kernel: string; arch: string; uptimeSecs: number; cpuModel: string; virt: string };
  memory?: { totalKb: number };
  tier: WidthTier;
  switcher: React.ReactNode;
}) {
  const t = useT();
  // Progressive reveal: CPU model (static, longest) only when wide; the
  // memory fact only from medium up (it's also a KPI tile). Name, switcher
  // and uptime never hide.
  const showCpu = tier === "wide";
  const showMem = tier !== "narrow";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
      background: "var(--panel-1)", borderBottom: "1px solid var(--border)", flexShrink: 0,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 8, background: "var(--accent-fade)",
        color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}><Server size={18} /></div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{system?.hostname || "—"}</div>
        {system && (
          <div style={{
            fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{[system.os, system.kernel, tier === "wide" ? system.arch : null, tier === "wide" ? system.virt : null].filter(Boolean).join(" · ")}</div>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, marginLeft: "auto", alignItems: "center", flexShrink: 0 }}>
        {system && showCpu && system.cpuModel && <Fact k="CPU" v={system.cpuModel} />}
        {system && showMem && memory && <Fact k={t("Memory")} v={fmtKb(memory.totalKb)} />}
        {system && (
          <span style={{
            fontSize: 11, color: "var(--success)", background: "var(--success-fade)",
            padding: "3px 9px", borderRadius: 999, fontWeight: 500, whiteSpace: "nowrap",
          }}>● {t("up")} {fmtUptime(system.uptimeSecs)}</span>
        )}
        {switcher}
      </div>
    </div>
  );
}
function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ fontSize: 11, color: "var(--text-2)", minWidth: 0, maxWidth: 220 }}>
      {k}
      <b style={{
        display: "block", fontSize: 12, color: "var(--text-1)", fontWeight: 600,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{v}</b>
    </div>
  );
}

function MonitorWaiting({ unsupported, intervalSecs }: { unsupported: boolean; intervalSecs: number }) {
  const t = useT();
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 10, textAlign: "center", padding: "56px 24px", color: "var(--text-2)",
    }}>
      {unsupported ? (
        <>
          <ShieldAlert size={26} strokeWidth={1.5} style={{ color: "var(--warn)" }} />
          <div style={{ fontSize: "var(--font-ui-size)", color: "var(--text-1)" }}>
            {t("Monitoring is not supported on this host (Linux only)")}
          </div>
          <div style={{ fontSize: "calc(var(--font-ui-size) - 2px)", color: "var(--text-3)" }}>
            {t("Terminal, files and tunnels still work here.")}
          </div>
        </>
      ) : (
        <>
          <span style={{ display: "inline-flex", gap: 4, fontSize: 20, lineHeight: 1, color: "var(--accent)", letterSpacing: 1 }}>
            <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out infinite" }}>·</span>
            <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out 0.2s infinite" }}>·</span>
            <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out 0.4s infinite" }}>·</span>
          </span>
          <div style={{ fontSize: "var(--font-ui-size)", color: "var(--text-1)" }}>{t("Collecting data…")}</div>
          <div style={{ fontSize: "calc(var(--font-ui-size) - 2px)", color: "var(--text-3)" }}>
            {t("First sample due in")} {intervalSecs}s
          </div>
        </>
      )}
    </div>
  );
}

const EMPTY: never[] = [];

export function MonitorPanel({ connectionId }: { connectionId: string }) {
  const t = useT();
  const [subTab, setSubTab] = useState<SubTab>("performance");
  const [unsupported, setUnsupported] = useState(false);
  const [intervalSecs, setIntervalSecs] = useState<IntervalSecs>(2);
  const snapshots = useMonitorStore((s) => s.snapshots[connectionId]) ?? EMPTY;
  const latest = snapshots[snapshots.length - 1];

  const unlistenSnapRef = useRef<(() => void) | undefined>(undefined);
  const unlistenUnsupRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void startMonitor(connectionId, intervalSecs).catch(() => {});
    onMonitorSnapshot(connectionId, (snap) => useMonitorStore.getState().push(snap))
      .then((u) => { if (cancelled) { u(); return; } unlistenSnapRef.current = u; }).catch(() => {});
    onMonitorUnsupported(connectionId, () => setUnsupported(true))
      .then((u) => { if (cancelled) { u(); return; } unlistenUnsupRef.current = u; }).catch(() => {});
    return () => {
      cancelled = true;
      void stopMonitor(connectionId).catch(() => {});
      unlistenSnapRef.current?.(); unlistenUnsupRef.current?.();
      unlistenSnapRef.current = undefined; unlistenUnsupRef.current = undefined;
      useMonitorStore.getState().clear(connectionId);
    };
  }, [connectionId, intervalSecs]);

  const waiting = unsupported || snapshots.length === 0;
  const [widthRef, tier] = useWidthTier<HTMLDivElement>();

  // A conditional sub-tab (containers, alerts) can disappear — fall back to
  // Performance so the pane never shows an orphaned empty view.
  useEffect(() => {
    if (subTab === "failed" && (latest?.failedUnits.length ?? 0) === 0) setSubTab("performance");
    if (subTab === "container" && !latest?.system.hasDocker) setSubTab("performance");
  }, [subTab, latest]);

  return (
    // The whole panel is a fixed-height flex column: identity, controls,
    // load and KPIs stay pinned; only the content region below scrolls.
    // Width is measured here (not the window) — the drawer changes it.
    <div ref={widthRef} style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--panel-2)", minHeight: 0 }}>
      {/* Host strip always renders — it holds the view switcher, so leaving
          the monitor is reachable even while the first sample loads. */}
      <HostStrip
        system={latest?.system}
        memory={latest?.memory}
        tier={tier}
        switcher={<ActivitySwitcher sessionId={connectionId} />}
      />

      {!waiting && (
        <div style={{
          padding: "9px 16px", display: "flex", alignItems: "center", gap: 6,
          background: "var(--panel-1)", borderBottom: "1px solid var(--border)",
          flexShrink: 0, flexWrap: "wrap",
        }}>
          {([["performance", t("Performance")], ["process", t("Process")], ["disk", t("Disk")]] as [SubTab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setSubTab(id)} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none",
              background: subTab === id ? "var(--accent)" : "transparent",
              color: subTab === id ? "var(--text-on-accent)" : "var(--text-2)",
              fontWeight: subTab === id ? 600 : 400,
            }}>{label}</button>
          ))}
          {latest?.system.hasDocker && (
            <button onClick={() => setSubTab("container")} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none",
              display: "inline-flex", alignItems: "center", gap: 5,
              background: subTab === "container" ? "var(--accent)" : "transparent",
              color: subTab === "container" ? "var(--text-on-accent)" : "var(--text-2)",
              fontWeight: subTab === "container" ? 600 : 400,
            }}>
              {t("Containers")}
              <span style={{
                fontSize: 10, minWidth: 15, textAlign: "center", borderRadius: 999, padding: "0 4px",
                background: subTab === "container" ? "rgba(255,255,255,0.25)" : "var(--panel-2)",
                color: subTab === "container" ? "#fff" : "var(--text-3)",
              }}>{latest.containers.length}</span>
            </button>
          )}
          {(latest?.failedUnits.length ?? 0) > 0 && (
            <button onClick={() => setSubTab("failed")} style={{
              padding: "5px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600,
              background: subTab === "failed" ? "var(--error)" : "var(--error-fade)",
              color: subTab === "failed" ? "#fff" : "var(--error)",
              border: `1px solid var(--error)`,
            }}>
              <TriangleAlert size={12} /> {t("Alerts")} {latest?.failedUnits.length}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("Refresh")}</span>
          <select value={intervalSecs} onChange={(e) => setIntervalSecs(Number(e.target.value) as IntervalSecs)} style={{
            fontSize: 11, background: "var(--panel-2)", color: "var(--text-2)",
            border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", cursor: "pointer",
          }}>
            {INTERVALS.map((s) => <option key={s} value={s}>{s}s</option>)}
          </select>
        </div>
      )}

      {!waiting && latest && <LoadBand latest={latest} showSinceBoot={tier === "wide"} />}

      {/* Scroll region: the KPI strip scrolls together with the content
          below it — everything under the load band moves as one. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {waiting && <MonitorWaiting unsupported={unsupported} intervalSecs={intervalSecs} />}
        {!waiting && <KpiRow snapshots={snapshots} onJump={setSubTab} />}
        {!waiting && subTab === "performance" && <PerformanceTab snapshots={snapshots} intervalSecs={intervalSecs} />}
        {!waiting && subTab === "process" && <ProcessTab processes={latest?.processes ?? []} />}
        {!waiting && subTab === "disk" && <DiskTab snapshots={snapshots} intervalSecs={intervalSecs} />}
        {!waiting && subTab === "container" && <ContainerTab containers={latest?.containers ?? []} />}
        {!waiting && subTab === "failed" && <FailedTab units={latest?.failedUnits ?? []} />}
      </div>
    </div>
  );
}

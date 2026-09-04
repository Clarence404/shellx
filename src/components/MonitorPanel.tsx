import { useEffect, useState, useRef } from "react";
import { ShieldAlert, Server, TerminalSquare, Folder, Network, Activity } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMonitorStore } from "../state/monitor";
import { startMonitor, stopMonitor, onMonitorSnapshot, onMonitorUnsupported } from "../ipc/monitor";
import { useSessions } from "../state/sessions";
import { useHostsStore } from "../state/hosts";
import { activitiesFor, clampActivity } from "../state/activities";
import type { ActivityKind } from "../types/connection";
import { KpiRow } from "./monitor/KpiRow";
import { LoadBand } from "./monitor/LoadBand";
import { PerformanceTab } from "./monitor/PerformanceTab";
import { ProcessTab } from "./monitor/ProcessTab";
import { DiskTab } from "./monitor/DiskTab";
import { fmtKb, fmtUptime } from "./monitor/format";
import { useT } from "../i18n";

type SubTab = "performance" | "process" | "disk";

const INTERVALS = [1, 2, 5, 10, 30] as const;
type IntervalSecs = typeof INTERVALS[number];

const ACT_ICON: Record<ActivityKind, LucideIcon> = {
  terminal: TerminalSquare,
  files: Folder,
  tunnel: Network,
  monitor: Activity,
};

/** Labeled activity switcher, docked at the LEFT of the bar. Same store
 *  actions as the shared icon-only one, but with text so "how do I get back
 *  to the terminal" is answerable at a glance. */
function ActivityTabs({ connectionId }: { connectionId: string }) {
  const t = useT();
  const session = useSessions((s) => s.sessions.find((x) => x.id === connectionId));
  const wanted = useSessions((s) => s.activeActivity[connectionId]);
  const hosts = useHostsStore((s) => s.hosts);
  const mode = hosts.find((h) => h.id === (session?.host_id ?? ""))?.connection_mode ?? "terminal_only";
  const options = activitiesFor(session, mode);
  const current = clampActivity(wanted, options);
  if (options.length < 2) return null;
  return (
    <div style={{ display: "inline-flex", gap: 2, background: "var(--panel-2)", borderRadius: 8, padding: 3 }}>
      {options.map((o) => {
        const Icon = ACT_ICON[o.id];
        const on = o.id === current;
        return (
          <button
            key={o.id}
            onClick={() => {
              useSessions.getState().setActive(connectionId);
              useSessions.getState().setActivity(connectionId, o.id);
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12,
              padding: "5px 11px", borderRadius: 6, cursor: "pointer", border: "none",
              background: on ? "var(--panel-1)" : "transparent",
              color: on ? "var(--text-1)" : "var(--text-2)",
              fontWeight: on ? 600 : 400,
              boxShadow: on ? "0 1px 3px rgba(20,24,40,0.12)" : "none",
            }}
          >
            <Icon size={13} /> {t(o.label)}
          </button>
        );
      })}
    </div>
  );
}

function HostStrip({ system, memory }: {
  system: { hostname: string; os: string; kernel: string; arch: string; uptimeSecs: number; cpuModel: string; virt: string };
  memory: { totalKb: number };
}) {
  const t = useT();
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, padding: "12px 16px",
      background: "var(--panel-1)", borderBottom: "1px solid var(--border)", flexShrink: 0,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 8, background: "var(--accent-fade)",
        color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}><Server size={18} /></div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{system.hostname || "—"}</div>
        <div style={{
          fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{[system.os, system.kernel, system.arch, system.virt].filter(Boolean).join(" · ")}</div>
      </div>
      <div style={{ display: "flex", gap: 16, marginLeft: "auto", alignItems: "center", flexWrap: "wrap" }}>
        {system.cpuModel && (
          <Fact k="CPU" v={system.cpuModel} />
        )}
        <Fact k={t("Memory")} v={fmtKb(memory.totalKb)} />
        <span style={{
          fontSize: 11, color: "var(--success)", background: "var(--success-fade)",
          padding: "3px 9px", borderRadius: 999, fontWeight: 500,
        }}>● {t("up")} {fmtUptime(system.uptimeSecs)}</span>
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

  return (
    // The whole panel is a fixed-height flex column: identity, controls,
    // load and KPIs stay pinned; only the content region below scrolls.
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--panel-2)", minHeight: 0 }}>
      {!waiting && latest && <HostStrip system={latest.system} memory={latest.memory} />}

      {/* Bar: activity switcher (left) · sub-tabs · refresh */}
      <div style={{
        padding: "9px 16px", display: "flex", alignItems: "center", gap: 6,
        background: "var(--panel-1)", borderBottom: "1px solid var(--border)",
        flexShrink: 0, flexWrap: "wrap",
      }}>
        <ActivityTabs connectionId={connectionId} />
        <span style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
        {([["performance", t("Performance")], ["process", t("Process")], ["disk", t("Disk")]] as [SubTab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setSubTab(id)} style={{
            padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none",
            background: subTab === id ? "var(--accent)" : "transparent",
            color: subTab === id ? "var(--text-on-accent)" : "var(--text-2)",
            fontWeight: subTab === id ? 600 : 400,
          }}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{t("Refresh")}</span>
        <select value={intervalSecs} onChange={(e) => setIntervalSecs(Number(e.target.value) as IntervalSecs)} style={{
          fontSize: 11, background: "var(--panel-2)", color: "var(--text-2)",
          border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", cursor: "pointer",
        }}>
          {INTERVALS.map((s) => <option key={s} value={s}>{s}s</option>)}
        </select>
      </div>

      {!waiting && latest && <LoadBand latest={latest} />}
      {!waiting && <KpiRow snapshots={snapshots} onJump={setSubTab} />}

      {/* Scroll region — the only thing that scrolls. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {waiting && <MonitorWaiting unsupported={unsupported} intervalSecs={intervalSecs} />}
        {!waiting && subTab === "performance" && <PerformanceTab snapshots={snapshots} intervalSecs={intervalSecs} />}
        {!waiting && subTab === "process" && <ProcessTab processes={latest?.processes ?? []} />}
        {!waiting && subTab === "disk" && <DiskTab snapshots={snapshots} intervalSecs={intervalSecs} />}
      </div>
    </div>
  );
}

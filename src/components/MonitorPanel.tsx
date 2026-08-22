import { useEffect, useState, useRef } from "react";
import { useMonitorStore } from "../state/monitor";
import { startMonitor, stopMonitor, onMonitorSnapshot, onMonitorUnsupported } from "../ipc/monitor";
import { HostInfoCard } from "./monitor/HostInfoCard";
import { ActivitySwitcherSlot } from "./paneChrome";
import { PerformanceTab } from "./monitor/PerformanceTab";
import { ProcessTab } from "./monitor/ProcessTab";
import { DiskTab } from "./monitor/DiskTab";
import { useT } from "../i18n";

type SubTab = "performance" | "process" | "disk";

const INTERVALS = [1, 2, 5, 10, 30] as const;
type IntervalSecs = typeof INTERVALS[number];

const EMPTY_SNAPSHOTS: never[] = [];
const EMPTY_SYSTEM = { hostname: "", os: "", kernel: "", arch: "", uptimeSecs: 0, cpuModel: "", virt: "" };
const EMPTY_DISK_IO = { readBytesPerSec: 0, writeBytesPerSec: 0 };
const EMPTY_MEMORY = { totalKb: 0, usedKb: 0, cachedKb: 0, freeKb: 0, swapTotalKb: 0, swapUsedKb: 0 };

interface Props { connectionId: string }

export function MonitorPanel({ connectionId }: Props) {
  const t = useT();
  const [subTab, setSubTab] = useState<SubTab>("performance");
  const [unsupported, setUnsupported] = useState(false);
  const [intervalSecs, setIntervalSecs] = useState<IntervalSecs>(2);
  const snapshots = useMonitorStore((s) => s.snapshots[connectionId]) ?? EMPTY_SNAPSHOTS;
  const latest = snapshots[snapshots.length - 1];

  const unlistenSnapRef = useRef<(() => void) | undefined>(undefined);
  const unlistenUnsupRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    void startMonitor(connectionId, intervalSecs).catch(() => {});

    onMonitorSnapshot(connectionId, (snap) => {
      useMonitorStore.getState().push(snap);
    }).then((u) => {
      if (cancelled) { u(); return; }
      unlistenSnapRef.current = u;
    }).catch(() => {});

    onMonitorUnsupported(connectionId, () => {
      setUnsupported(true);
    }).then((u) => {
      if (cancelled) { u(); return; }
      unlistenUnsupRef.current = u;
    }).catch(() => {});

    return () => {
      cancelled = true;
      void stopMonitor(connectionId).catch(() => {});
      unlistenSnapRef.current?.();
      unlistenUnsupRef.current?.();
      unlistenSnapRef.current = undefined;
      unlistenUnsupRef.current = undefined;
      useMonitorStore.getState().clear(connectionId);
    };
  }, [connectionId, intervalSecs]);

  if (unsupported) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-3)", fontSize: 13, flexDirection: "column", gap: 8,
        background: "var(--panel-2)",
      }}>
        <span style={{ fontSize: 24 }}>&#9888;</span>
        {t("Monitoring is not supported on this host (Linux only)")}
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-3)", fontSize: 13,
        background: "var(--panel-2)",
      }}>
        {t("Collecting data…")}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--panel-2)", overflow: "hidden" }}>
      <HostInfoCard
        system={latest?.system ?? EMPTY_SYSTEM}
        memory={latest?.memory ?? EMPTY_MEMORY}
        connectionId={connectionId}
      />

      {/* Sub-tab bar */}
      <div style={{
        height: 36, padding: "0 12px", display: "flex", alignItems: "center",
        gap: 4, background: "var(--panel-1)", borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        {([
          ["performance", t("Performance")],
          ["process", t("Process")],
          ["disk", t("Disk")],
        ] as [SubTab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            style={{
              padding: "3px 12px", borderRadius: 4,
              fontSize: "var(--font-ui-size)",
              background: subTab === id ? "var(--accent)" : "transparent",
              color: subTab === id ? "var(--text-on-accent)" : "var(--text-2)",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "var(--text-3)", marginRight: 4 }}>{t("Refresh")}</span>
        <select
          value={intervalSecs}
          onChange={(e) => setIntervalSecs(Number(e.target.value) as IntervalSecs)}
          style={{
            fontSize: 11, background: "var(--panel-2)", color: "var(--text-2)",
            border: "1px solid var(--border)", borderRadius: 4, padding: "2px 4px",
            cursor: "pointer",
          }}
        >
          {INTERVALS.map((s) => (
            <option key={s} value={s}>{s}s</option>
          ))}
        </select>
              <ActivitySwitcherSlot sessionId={connectionId} />
      </div>

      {/* Sub-tab content */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {subTab === "performance" && (
          <PerformanceTab snapshots={snapshots} diskIo={latest?.diskIo ?? EMPTY_DISK_IO} />
        )}
        {subTab === "process" && <ProcessTab processes={latest?.processes ?? []} />}
        {subTab === "disk" && (
          <DiskTab
            disks={latest?.disks ?? []}
            diskIo={latest?.diskIo ?? EMPTY_DISK_IO}
            snapshots={snapshots}
          />
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, useRef } from "react";
import { useMonitorStore } from "../state/monitor";
import { startMonitor, stopMonitor, onMonitorSnapshot, onMonitorUnsupported } from "../ipc/monitor";
import { HostInfoCard } from "./monitor/HostInfoCard";
import { PerformanceTab } from "./monitor/PerformanceTab";
import { ProcessTab } from "./monitor/ProcessTab";
import { DiskTab } from "./monitor/DiskTab";

type SubTab = "performance" | "process" | "disk";

const EMPTY_SNAPSHOTS: never[] = [];
const EMPTY_SYSTEM = { hostname: "", os: "", kernel: "", arch: "", uptimeSecs: 0 };
const EMPTY_DISK_IO = { readBytesPerSec: 0, writeBytesPerSec: 0 };

interface Props { connectionId: string }

export function MonitorPanel({ connectionId }: Props) {
  const [subTab, setSubTab] = useState<SubTab>("performance");
  const [unsupported, setUnsupported] = useState(false);
  const snapshots = useMonitorStore((s) => s.snapshots[connectionId]) ?? EMPTY_SNAPSHOTS;
  const latest = snapshots[snapshots.length - 1];

  const unlistenSnapRef = useRef<(() => void) | undefined>(undefined);
  const unlistenUnsupRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    void startMonitor(connectionId).catch(() => {});

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
  }, [connectionId]);

  if (unsupported) {
    return (
      <div style={{
        height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        color: "var(--text-3)", fontSize: 13, flexDirection: "column", gap: 8,
        background: "var(--panel-2)",
      }}>
        <span style={{ fontSize: 24 }}>&#9888;</span>
        此主机不支持监控（仅支持 Linux）
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
        正在采集数据…
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--panel-2)", overflow: "hidden" }}>
      <HostInfoCard system={latest?.system ?? EMPTY_SYSTEM} />

      {/* Sub-tab bar */}
      <div style={{
        height: 36, padding: "0 12px", display: "flex", alignItems: "center",
        gap: 4, background: "var(--panel-1)", borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        {([
          ["performance", "性能"],
          ["process", "进程"],
          ["disk", "磁盘"],
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
      </div>

      {/* Sub-tab content */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {subTab === "performance" && <PerformanceTab snapshots={snapshots} />}
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

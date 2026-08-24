import { useEffect, useState, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { useMonitorStore } from "../state/monitor";
import { startMonitor, stopMonitor, onMonitorSnapshot, onMonitorUnsupported } from "../ipc/monitor";
import { HostInfoCard } from "./monitor/HostInfoCard";
import { ActivitySwitcherSlot } from "./paneChrome";
import { PerformanceTab } from "./monitor/PerformanceTab";
import { ProcessTab } from "./monitor/ProcessTab";
import { DiskTab } from "./monitor/DiskTab";
import { useT } from "../i18n";

type SubTab = "performance" | "process" | "disk";

/** Height of the sticky sub-tab bar. The process table's own sticky
 *  header parks directly under it. */
export const SUBTAB_HEIGHT = 36;

/**
 * What the Monitor tab shows before the first snapshot lands, and on a host
 * that can't be monitored at all. Rendered under the sub-tab bar rather
 * than in place of the whole panel, so the activity switcher living in that
 * bar stays reachable.
 */
function MonitorWaiting({ unsupported, intervalSecs }: {
  unsupported: boolean;
  intervalSecs: number;
}) {
  const t = useT();
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 10, textAlign: "center",
      padding: "56px 24px", color: "var(--text-2)",
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
          <span style={{
            display: "inline-flex", gap: 4, fontSize: 20, lineHeight: 1,
            color: "var(--accent)", letterSpacing: 1,
          }}>
            <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out infinite" }}>·</span>
            <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out 0.2s infinite" }}>·</span>
            <span style={{ animation: "shellx-dot-pulse 1.4s ease-in-out 0.4s infinite" }}>·</span>
          </span>
          <div style={{ fontSize: "var(--font-ui-size)", color: "var(--text-1)" }}>
            {t("Collecting data…")}
          </div>
          <div style={{ fontSize: "calc(var(--font-ui-size) - 2px)", color: "var(--text-3)" }}>
            {t("First sample due in")} {intervalSecs}s
          </div>
        </>
      )}
    </div>
  );
}


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

  // These used to `return` before the sub-tab bar rendered — and since the
  // activity switcher docks into that bar, a host that was still sampling
  // (or isn't Linux at all) left no way back to Terminal or Files from
  // inside the pane. The bar always renders now; only the content below it
  // changes.
  const waiting = unsupported || snapshots.length === 0;

  return (
    // One scroll container for the whole panel: the host card scrolls
    // away with the content and only the sub-tab bar stays put. Each tab
    // below flows at its natural height — none of them may scroll on their
    // own, or this turns into a scrollbar inside a scrollbar.
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      background: "var(--panel-2)", overflowY: "auto",
    }}>
      {!waiting && (
        <HostInfoCard
          system={latest?.system ?? EMPTY_SYSTEM}
          memory={latest?.memory ?? EMPTY_MEMORY}
          connectionId={connectionId}
        />
      )}

      {/* Sub-tab bar */}
      <div style={{
        height: SUBTAB_HEIGHT, padding: "0 12px", display: "flex", alignItems: "center",
        gap: 4, background: "var(--panel-1)", borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        // Sticks to the top of the panel's scroll: switching sub-tab or
        // changing the interval must not require scrolling back up.
        position: "sticky", top: 0, zIndex: 3,
        boxShadow: "0 4px 10px rgba(16,20,28,0.05)",
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

      {/* Sub-tab content — flows; the panel above owns the scrolling. */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {waiting && (
          <MonitorWaiting
            unsupported={unsupported}
            intervalSecs={intervalSecs}
          />
        )}
        {!waiting && subTab === "performance" && (
          <PerformanceTab snapshots={snapshots} diskIo={latest?.diskIo ?? EMPTY_DISK_IO} />
        )}
        {!waiting && subTab === "process" && <ProcessTab processes={latest?.processes ?? []} />}
        {!waiting && subTab === "disk" && (
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

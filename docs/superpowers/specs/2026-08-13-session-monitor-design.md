# Session Monitor Tab — Design Spec

**Date:** 2026-08-13  
**Status:** Approved

## Goal

Add a "监控" third tab to SSH session views (alongside 终端 and 文件), showing live system metrics sampled from the remote Linux host via SSH exec channels. Three sub-tabs: 性能 (Performance), 进程 (Processes), 磁盘 (Disk). Pure read-only; no process signals or disk operations.

## Placement

The monitor tab appears only for SSH sessions. Local terminal and serial sessions do not show it. The tab bar becomes: `终端 | 文件 | 监控` — implemented by checking `session.kind === "ssh"` in the tab renderer.

## Data collection

### Mechanism

Each active monitor session opens a **non-PTY exec channel** on the existing SSH connection (separate from the terminal PTY). Every poll interval the Rust backend executes a single compound shell command via `SshConnection::exec()` (to be added alongside the existing PTY and SFTP open paths), parses the output, and emits a `monitor:snapshot` Tauri event to the frontend.

No persistent agent or daemon is uploaded to the remote. The command exits after each poll.

### Poll interval

Fixed at **3 seconds**. Not user-configurable in this release.

### History

The frontend retains the last **60 snapshots** per connection (~3 minutes at 3 s intervals) for sparkline history. Older snapshots are discarded.

### Platform support

Requires `/proc` filesystem — Linux only. Before starting the poll loop, the backend executes `test -f /proc/stat && echo ok`. If the response is not `ok`, polling stops and an `unsupported` flag is emitted; the UI shows "当前主机不支持监控（仅支持 Linux）".

### Shell command (one shot per poll)

```sh
echo '---STAT---'; cat /proc/stat
echo '---MEM---'; cat /proc/meminfo
echo '---NET---'; cat /proc/net/dev
echo '---PS---'; ps -eo pid,pcpu,pmem,comm --sort=-%cpu --no-headers 2>/dev/null | head -50
echo '---DF---'; df -Ph 2>/dev/null
echo '---DISKIO---'; cat /proc/diskstats
echo '---UPTIME---'; cat /proc/uptime; uname -snrm; hostname
```

### CPU calculation

`/proc/stat` gives cumulative tick counts. CPU % is computed from two consecutive readings (delta user + nice + system) / delta total. The Rust task stores the previous reading; the first snapshot after start emits `cpu_pct: null` (frontend shows "—" until the second poll arrives).

## Data types

### `MonitorSnapshot` (emitted as Tauri event payload)

```typescript
interface MonitorSnapshot {
  connectionId: string;
  ts: number;                    // unix ms
  cpu: CpuInfo | null;           // null on first poll
  memory: MemInfo;
  network: NetworkInfo[];        // per-interface
  processes: ProcessRow[];       // top 50 by CPU
  disks: DiskMount[];            // df output
  diskIo: DiskIo;                // aggregate read/write KB/s
  system: SystemInfo;
}

interface CpuInfo {
  totalPct: number;              // 0–100
  corePct: number[];             // per-core, same range
}

interface MemInfo {
  totalKb: number;
  usedKb: number;
  cachedKb: number;
  freeKb: number;
  swapTotalKb: number;
  swapUsedKb: number;
}

interface NetworkInfo {
  iface: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

interface ProcessRow {
  pid: number;
  cpuPct: number;
  memPct: number;
  name: string;
}

interface DiskMount {
  target: string;
  sizeMb: number;
  usedMb: number;
  availMb: number;
  usePct: number;                // 0–100
}

interface DiskIo {
  readBytesPerSec: number;
  writeBytesPerSec: number;
}

interface SystemInfo {
  hostname: string;
  os: string;                    // uname -s
  kernel: string;                // uname -r
  arch: string;                  // uname -m
  uptimeSecs: number;
}
```

## Architecture

### Backend (new)

**`src-tauri/src/monitor/mod.rs`**

- `MonitorTask` struct: holds `ConnectionId`, previous `/proc/stat` reading, previous `/proc/diskstats` and `/proc/net/dev` readings for delta computation, and previous poll timestamp.
- `start_poll_loop(conn_id, ssh_conn, app_handle)` → `AbortHandle`: spawns a tokio task that loops with `tokio::time::sleep(Duration::from_secs(3))`, calls `exec_snapshot`, parses, emits `monitor:snapshot` event.
- `exec_snapshot(ssh_conn)` → `String`: opens a single exec channel on the connection, runs the compound command, collects stdout to string, closes channel.
- Parse functions: `parse_stat`, `parse_meminfo`, `parse_netdev`, `parse_ps`, `parse_df`, `parse_diskstats`, `parse_uptime_uname` — each takes the relevant section string and returns the typed struct.

**`src-tauri/src/monitor/manager.rs`**

- `MonitorManager`: `HashMap<ConnectionId, AbortHandle>` wrapped in `Mutex`.
- `start(conn_id)` / `stop(conn_id)` methods — stop aborts the task.
- Registered as Tauri state.

**`src-tauri/src/ipc/monitor.rs`**

```rust
#[tauri::command]
pub async fn start_monitor(conn_id: String, ...) -> Result<()>

#[tauri::command]
pub async fn stop_monitor(conn_id: String, ...) -> Result<()>
```

**`src-tauri/src/protocol/ssh.rs`** — add `exec(cmd: &str)` method to `SshConnection` that opens a non-PTY exec channel, runs the command, reads all stdout, returns `String`.

**`src-tauri/src/main.rs`** — register `start_monitor`, `stop_monitor` commands; add `MonitorManager` to managed state.

### Frontend (new)

**`src/types/monitor.ts`** — all interfaces above.

**`src/ipc/monitor.ts`** — `startMonitor(connId)` / `stopMonitor(connId)` invoke wrappers + `onMonitorSnapshot(cb)` event listener (returns unlisten fn).

**`src/state/monitor.ts`** — Zustand store:
```typescript
interface MonitorState {
  snapshots: Record<string, MonitorSnapshot[]>;  // connId → last 60
  push(snap: MonitorSnapshot): void;
  clear(connId: string): void;
}
```
Keeps only the last 60 snapshots per connection; old ones shift out.

**`src/components/MonitorPanel.tsx`** — main container. On mount: calls `startMonitor(connId)`, subscribes to `onMonitorSnapshot`. On unmount: calls `stopMonitor(connId)`, unlistens. Renders host info card + sub-tab switcher + active sub-tab panel.

**`src/components/monitor/HostInfoCard.tsx`** — displays `SystemInfo` + uptime formatted as "N 天 N 小时". Uses the most recent snapshot's `system` field.

**`src/components/monitor/PerformanceTab.tsx`** — three metric cards (CPU, memory, network). CPU card shows total%, per-core bar rows (first 6 + "展开" for rest), and sparkline. Memory card shows %, amount, sparkline, distribution bar, swap row. Network card shows per-interface down/up with sparklines (if multiple interfaces, one row each).

**`src/components/monitor/ProcessTab.tsx`** — table: PID | CPU% | MEM% | 进程. Sorted by CPU descending. Top CPU row gets a blue `CPU` badge; top MEM row gets a green `MEM` badge. Bottom bar shows top CPU name and top MEM name. Fixed 50-row display, no pagination.

**`src/components/monitor/DiskTab.tsx`** — mount point list: each row shows path, usage bar (color: green <60%, orange 60–80%, red >80%), percentage, used/total. Below: disk I/O card with read/write KB/s and sparklines.

**`src/components/monitor/Sparkline.tsx`** — pure SVG sparkline. Props: `data: number[]`, `color: string`, `fill: string`, `height: number`. Computes min/max from data, maps to SVG polyline points. Renders a filled area path + stroke polyline. No external deps.

### Frontend (modified)

The tab bar component that renders 终端 / 文件 — add a third tab "监控" conditionally for SSH sessions. When the monitor tab is active, render `<MonitorPanel connectionId={connId} />`.

## File change summary

| File | Change |
|------|--------|
| `src-tauri/src/monitor/mod.rs` | New: MonitorTask, poll loop, parse functions |
| `src-tauri/src/monitor/manager.rs` | New: MonitorManager |
| `src-tauri/src/ipc/monitor.rs` | New: start_monitor / stop_monitor commands |
| `src-tauri/src/protocol/ssh.rs` | Add `exec(cmd)` method to SshConnection |
| `src-tauri/src/main.rs` | Register commands + MonitorManager state |
| `src/types/monitor.ts` | New: all data interfaces |
| `src/ipc/monitor.ts` | New: IPC wrappers + event listener |
| `src/state/monitor.ts` | New: Zustand store |
| `src/components/MonitorPanel.tsx` | New: main container |
| `src/components/monitor/HostInfoCard.tsx` | New |
| `src/components/monitor/PerformanceTab.tsx` | New |
| `src/components/monitor/ProcessTab.tsx` | New |
| `src/components/monitor/DiskTab.tsx` | New |
| `src/components/monitor/Sparkline.tsx` | New |
| Tab bar / `App.tsx` | Add monitor tab for SSH sessions |

## Global constraints

- SSH exec channel is separate from the terminal PTY — does not interfere with the user's terminal session.
- No data is written to the remote host; no files are uploaded.
- Process list is view-only — no kill/signal actions.
- Linux `/proc`-only; unsupported hosts show a clear error message.
- First CPU snapshot emits `null` for `cpu` — UI shows "—" until delta is available.
- Poll loop is aborted when the monitor tab is unmounted or the session closes.
- `schemaVersion` stays at 1 — monitor data is ephemeral, not persisted.

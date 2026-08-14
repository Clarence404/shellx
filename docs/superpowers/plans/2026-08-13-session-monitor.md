# Session Monitor Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "监控" third tab to SSH session views showing live CPU, memory, disk, and network metrics sampled from the remote Linux host via SSH exec channels.

**Architecture:** The Rust backend opens non-PTY exec channels on the existing SSH connection every 3 seconds, collects `/proc` metrics via a compound shell command, parses them, and emits a `monitor:snapshot` Tauri event. The frontend stores the last 60 snapshots per connection in a Zustand store and renders them in three sub-tabs (性能 / 进程 / 磁盘) using pure-SVG sparklines.

**Tech Stack:** Rust (tokio, russh), Tauri 2, React/TypeScript, Zustand, lucide-react, inline SVG

## Global Constraints

- Monitor tab visible only for SSH sessions (`kind === "ssh"`) — not local or serial.
- No PTY opened; exec channel is separate from the user's terminal session.
- Linux `/proc` only. Unsupported hosts show a Chinese error message; UI must not crash.
- First poll emits `cpu: null` (no delta yet) — UI shows "—" for CPU until 2nd poll.
- Process list is view-only — no kill/signal actions, no buttons.
- Poll loop aborts when MonitorPanel unmounts or session closes.
- No data written to remote host; no files uploaded.
- Commit author must be `ChenHan <1154937362@qq.com>` — no Co-Authored-By.
- All work on branch `feat/session-monitor`.

---

### Task 1: SSH exec helper

**Files:**
- Modify: `src-tauri/src/protocol/ssh.rs`

**Interfaces:**
- Produces: `pub(crate) async fn exec_cmd(handle: &RusshHandle, cmd: &str) -> Result<String>` (free function)
- Produces: `pub async fn exec(&self, cmd: &str) -> Result<String>` on `SshConnection`

- [ ] **Step 1: Add `exec_cmd` free function and `SshConnection::exec` method**

  In `src-tauri/src/protocol/ssh.rs`, add after the `open_sftp` method (around line 164):

  ```rust
  /// Runs a one-shot exec command on the given SSH connection handle and
  /// collects all stdout. Returns empty string on connection error (caller
  /// decides whether to retry).
  pub(crate) async fn exec_cmd(handle: &RusshHandle, cmd: &str) -> Result<String> {
      let mut channel = handle
          .channel_open_session()
          .await
          .map_err(|e| Error::Protocol(format!("exec open session: {e}")))?;
      channel
          .exec(true, cmd.as_bytes())
          .await
          .map_err(|e| Error::Protocol(format!("exec request: {e}")))?;
      let mut buf: Vec<u8> = Vec::new();
      loop {
          match channel.wait().await {
              Some(ChannelMsg::Data { data }) => buf.extend_from_slice(&data),
              Some(ChannelMsg::ExtendedData { .. }) => {}
              Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
              Some(ChannelMsg::ExitStatus { .. }) => {}
              _ => {}
          }
      }
      Ok(String::from_utf8_lossy(&buf).into_owned())
  }
  ```

  In `impl SshConnection` block (after `handle_clone`):

  ```rust
  pub async fn exec(&self, cmd: &str) -> Result<String> {
      exec_cmd(&self.handle, cmd).await
  }
  ```

- [ ] **Step 2: Verify it compiles**

  ```bash
  cd src-tauri && cargo check 2>&1 | head -30
  ```

  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add src-tauri/src/protocol/ssh.rs
  git commit -m "feat(monitor): add exec_cmd helper and SshConnection::exec method"
  ```

---

### Task 2: Monitor backend — MonitorTask + parse functions

**Files:**
- Create: `src-tauri/src/monitor/mod.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod monitor;`)

**Interfaces:**
- Consumes: `exec_cmd` from Task 1 (`crate::protocol::ssh::exec_cmd`)
- Consumes: `crate::protocol::RusshHandle`
- Produces: `pub fn start_poll_loop(conn_id: String, handle: RusshHandle, app: AppHandle) -> tokio::task::AbortHandle`
- Produces (internal): all `parse_*` functions, `MonitorSnapshot` and sub-structs as `#[derive(Serialize, Clone)]`

- [ ] **Step 1: Add `pub mod monitor;` to `src-tauri/src/lib.rs`**

  Append to `src-tauri/src/lib.rs`:

  ```rust
  pub mod monitor;
  ```

- [ ] **Step 2: Write `src-tauri/src/monitor/mod.rs`**

  Create the file with the full content below:

  ```rust
  use crate::error::{Error, Result};
  use crate::protocol::ssh::exec_cmd;
  use crate::protocol::RusshHandle;
  use serde::Serialize;
  use std::collections::HashMap;
  use tauri::{AppHandle, Emitter};
  use tokio::time::{sleep, Duration};

  pub const EV_SNAPSHOT: &str = "monitor:snapshot";
  pub const EV_UNSUPPORTED: &str = "monitor:unsupported";

  const POLL_INTERVAL: Duration = Duration::from_secs(3);

  const POLL_CMD: &str = concat!(
      "echo '---STAT---'; cat /proc/stat; ",
      "echo '---MEM---'; cat /proc/meminfo; ",
      "echo '---NET---'; cat /proc/net/dev; ",
      "echo '---PS---'; ps -eo pid,pcpu,pmem,comm --sort=-%cpu --no-headers 2>/dev/null | head -50; ",
      "echo '---DF---'; df -Ph 2>/dev/null; ",
      "echo '---DISKIO---'; cat /proc/diskstats; ",
      "echo '---UPTIME---'; cat /proc/uptime; uname -snrm; hostname"
  );

  // ── Serializable snapshot types ─────────────────────────────────────────────

  #[derive(Serialize, Clone, Debug)]
  #[serde(rename_all = "camelCase")]
  pub struct MonitorSnapshot {
      pub connection_id: String,
      pub ts: u64,
      pub cpu: Option<CpuInfo>,
      pub memory: MemInfo,
      pub network: Vec<NetworkInfo>,
      pub processes: Vec<ProcessRow>,
      pub disks: Vec<DiskMount>,
      pub disk_io: DiskIo,
      pub system: SystemInfo,
  }

  #[derive(Serialize, Clone, Debug)]
  #[serde(rename_all = "camelCase")]
  pub struct CpuInfo {
      pub total_pct: f64,
      pub core_pct: Vec<f64>,
  }

  #[derive(Serialize, Clone, Debug, Default)]
  #[serde(rename_all = "camelCase")]
  pub struct MemInfo {
      pub total_kb: u64,
      pub used_kb: u64,
      pub cached_kb: u64,
      pub free_kb: u64,
      pub swap_total_kb: u64,
      pub swap_used_kb: u64,
  }

  #[derive(Serialize, Clone, Debug)]
  #[serde(rename_all = "camelCase")]
  pub struct NetworkInfo {
      pub iface: String,
      pub rx_bytes_per_sec: u64,
      pub tx_bytes_per_sec: u64,
  }

  #[derive(Serialize, Clone, Debug)]
  #[serde(rename_all = "camelCase")]
  pub struct ProcessRow {
      pub pid: u32,
      pub cpu_pct: f64,
      pub mem_pct: f64,
      pub name: String,
  }

  #[derive(Serialize, Clone, Debug)]
  #[serde(rename_all = "camelCase")]
  pub struct DiskMount {
      pub target: String,
      pub size_mb: u64,
      pub used_mb: u64,
      pub avail_mb: u64,
      pub use_pct: u32,
  }

  #[derive(Serialize, Clone, Debug, Default)]
  #[serde(rename_all = "camelCase")]
  pub struct DiskIo {
      pub read_bytes_per_sec: u64,
      pub write_bytes_per_sec: u64,
  }

  #[derive(Serialize, Clone, Debug, Default)]
  #[serde(rename_all = "camelCase")]
  pub struct SystemInfo {
      pub hostname: String,
      pub os: String,
      pub kernel: String,
      pub arch: String,
      pub uptime_secs: u64,
  }

  // ── Internal delta-tracking types ───────────────────────────────────────────

  #[derive(Clone, Debug)]
  struct CpuTicks {
      user: u64, nice: u64, system: u64, idle: u64,
      iowait: u64, irq: u64, softirq: u64, steal: u64,
  }

  impl CpuTicks {
      fn total(&self) -> u64 {
          self.user + self.nice + self.system + self.idle
              + self.iowait + self.irq + self.softirq + self.steal
      }
      fn idle_total(&self) -> u64 { self.idle + self.iowait }
  }

  #[derive(Clone, Debug, Default)]
  struct NetRaw { rx: u64, tx: u64 }

  #[derive(Clone, Debug, Default)]
  struct DiskIoRaw { read_sectors: u64, write_sectors: u64 }

  struct PrevState {
      cpu_ticks: Vec<CpuTicks>,
      net: HashMap<String, NetRaw>,
      disk_io: DiskIoRaw,
      ts: std::time::Instant,
  }

  // ── Section extractor ────────────────────────────────────────────────────────

  fn extract_section<'a>(output: &'a str, tag: &str) -> &'a str {
      let marker = format!("---{}---", tag);
      let start = match output.find(&marker) {
          Some(i) => i + marker.len(),
          None => return "",
      };
      let rest = &output[start..];
      match rest.find("\n---") {
          Some(end) => &rest[..end],
          None => rest,
      }
  }

  // ── Parse functions ──────────────────────────────────────────────────────────

  fn parse_cpu_ticks(section: &str) -> Vec<CpuTicks> {
      section.lines()
          .filter(|l| l.starts_with("cpu"))
          .map(|l| {
              let n: Vec<u64> = l.split_whitespace().skip(1)
                  .take(8).filter_map(|s| s.parse().ok()).collect();
              CpuTicks {
                  user:    n.get(0).copied().unwrap_or(0),
                  nice:    n.get(1).copied().unwrap_or(0),
                  system:  n.get(2).copied().unwrap_or(0),
                  idle:    n.get(3).copied().unwrap_or(0),
                  iowait:  n.get(4).copied().unwrap_or(0),
                  irq:     n.get(5).copied().unwrap_or(0),
                  softirq: n.get(6).copied().unwrap_or(0),
                  steal:   n.get(7).copied().unwrap_or(0),
              }
          }).collect()
  }

  fn cpu_delta(prev: &[CpuTicks], curr: &[CpuTicks]) -> CpuInfo {
      let calc = |p: &CpuTicks, c: &CpuTicks| -> f64 {
          let dt = c.total().saturating_sub(p.total());
          if dt == 0 { return 0.0; }
          let di = c.idle_total().saturating_sub(p.idle_total());
          ((dt.saturating_sub(di)) as f64 / dt as f64 * 100.0).clamp(0.0, 100.0)
      };
      let total_pct = prev.first().zip(curr.first())
          .map(|(p, c)| calc(p, c)).unwrap_or(0.0);
      let core_pct = prev.iter().skip(1).zip(curr.iter().skip(1))
          .map(|(p, c)| calc(p, c)).collect();
      CpuInfo { total_pct, core_pct }
  }

  fn parse_meminfo(section: &str) -> MemInfo {
      let mut map: HashMap<&str, u64> = HashMap::new();
      for line in section.lines() {
          if let Some((key, rest)) = line.split_once(':') {
              let val: u64 = rest.split_whitespace().next()
                  .and_then(|s| s.parse().ok()).unwrap_or(0);
              map.insert(key.trim(), val);
          }
      }
      let total     = *map.get("MemTotal").unwrap_or(&0);
      let free      = *map.get("MemFree").unwrap_or(&0);
      let available = *map.get("MemAvailable").unwrap_or(&0);
      let cached    = *map.get("Cached").unwrap_or(&0);
      let swap_total = *map.get("SwapTotal").unwrap_or(&0);
      let swap_free  = *map.get("SwapFree").unwrap_or(&0);
      MemInfo {
          total_kb: total,
          used_kb: total.saturating_sub(available),
          cached_kb: cached,
          free_kb: free,
          swap_total_kb: swap_total,
          swap_used_kb: swap_total.saturating_sub(swap_free),
      }
  }

  fn parse_netdev_raw(section: &str) -> HashMap<String, NetRaw> {
      let mut map = HashMap::new();
      for line in section.lines().skip(2) {
          let line = line.trim();
          if let Some(colon) = line.find(':') {
              let iface = line[..colon].trim().to_string();
              let nums: Vec<u64> = line[colon + 1..].split_whitespace()
                  .filter_map(|s| s.parse().ok()).collect();
              if nums.len() >= 9 {
                  map.insert(iface, NetRaw { rx: nums[0], tx: nums[8] });
              }
          }
      }
      map
  }

  fn net_delta(
      prev: &HashMap<String, NetRaw>,
      curr: &HashMap<String, NetRaw>,
      elapsed_secs: f64,
  ) -> Vec<NetworkInfo> {
      let mut result: Vec<NetworkInfo> = curr.iter()
          .filter(|(iface, _)| *iface != "lo")
          .filter_map(|(iface, c)| {
              prev.get(iface).map(|p| NetworkInfo {
                  iface: iface.clone(),
                  rx_bytes_per_sec: ((c.rx.saturating_sub(p.rx)) as f64 / elapsed_secs) as u64,
                  tx_bytes_per_sec: ((c.tx.saturating_sub(p.tx)) as f64 / elapsed_secs) as u64,
              })
          }).collect();
      result.sort_by(|a, b| a.iface.cmp(&b.iface));
      result
  }

  fn parse_ps(section: &str) -> Vec<ProcessRow> {
      section.lines()
          .filter(|l| !l.trim().is_empty())
          .filter_map(|l| {
              let mut p = l.split_whitespace();
              let pid: u32 = p.next()?.parse().ok()?;
              let cpu: f64 = p.next()?.parse().ok()?;
              let mem: f64 = p.next()?.parse().ok()?;
              let name = p.next()?.to_string();
              Some(ProcessRow { pid, cpu_pct: cpu, mem_pct: mem, name })
          }).collect()
  }

  fn parse_size_mb(s: &str) -> u64 {
      if s == "0" { return 0; }
      let (num_s, unit) = s.split_at(s.len().saturating_sub(1));
      let n: f64 = num_s.parse().unwrap_or(0.0);
      match unit {
          "T" => (n * 1_000_000.0) as u64,
          "G" => (n * 1_000.0) as u64,
          "M" => n as u64,
          "K" => (n / 1_000.0) as u64,
          _ => num_s.parse::<f64>().unwrap_or(0.0) as u64 / 1_048_576,
      }
  }

  fn parse_df(section: &str) -> Vec<DiskMount> {
      section.lines().skip(1)
          .filter(|l| !l.trim().is_empty())
          .filter_map(|l| {
              let p: Vec<&str> = l.split_whitespace().collect();
              if p.len() < 6 { return None; }
              let use_pct: u32 = p[4].trim_end_matches('%').parse().unwrap_or(0);
              Some(DiskMount {
                  target: p[5].to_string(),
                  size_mb: parse_size_mb(p[1]),
                  used_mb: parse_size_mb(p[2]),
                  avail_mb: parse_size_mb(p[3]),
                  use_pct,
              })
          }).collect()
  }

  fn is_whole_disk(name: &str) -> bool {
      if name.starts_with("loop") || name.starts_with("ram") || name.starts_with("dm-") {
          return false;
      }
      if name.starts_with("nvme") {
          // nvme0n1 = whole disk; nvme0n1p1 = partition (has 'p' after 'n\d')
          return !name.rfind('p').map_or(false, |i| i > 4);
      }
      // sda, vda, hda: whole disk ends in letter; sda1 ends in digit
      !name.chars().last().map_or(false, |c| c.is_ascii_digit())
  }

  fn parse_diskstats_raw(section: &str) -> DiskIoRaw {
      let (mut rd, mut wr) = (0u64, 0u64);
      for line in section.lines() {
          let p: Vec<&str> = line.split_whitespace().collect();
          if p.len() < 10 { continue; }
          if !is_whole_disk(p[2]) { continue; }
          rd += p[5].parse::<u64>().unwrap_or(0);   // rd_sectors
          wr += p[9].parse::<u64>().unwrap_or(0);   // wr_sectors
      }
      DiskIoRaw { read_sectors: rd, write_sectors: wr }
  }

  fn diskio_delta(prev: &DiskIoRaw, curr: &DiskIoRaw, elapsed_secs: f64) -> DiskIo {
      let rd = curr.read_sectors.saturating_sub(prev.read_sectors);
      let wr = curr.write_sectors.saturating_sub(prev.write_sectors);
      DiskIo {
          read_bytes_per_sec:  ((rd as f64 * 512.0) / elapsed_secs) as u64,
          write_bytes_per_sec: ((wr as f64 * 512.0) / elapsed_secs) as u64,
      }
  }

  fn parse_uptime_uname(section: &str) -> SystemInfo {
      let mut lines = section.lines().filter(|l| !l.trim().is_empty());
      let uptime_secs: u64 = lines.next()
          .and_then(|l| l.split_whitespace().next())
          .and_then(|s| s.split('.').next())
          .and_then(|s| s.parse().ok())
          .unwrap_or(0);
      let (os, kernel, arch) = lines.next()
          .map(|l| {
              let p: Vec<&str> = l.split_whitespace().collect();
              (
                  p.first().copied().unwrap_or("").to_string(),
                  p.get(2).copied().unwrap_or("").to_string(),
                  p.get(3).copied().unwrap_or("").to_string(),
              )
          })
          .unwrap_or_default();
      let hostname = lines.next().unwrap_or("").trim().to_string();
      SystemInfo { hostname, os, kernel, arch, uptime_secs }
  }

  // ── Poll loop ────────────────────────────────────────────────────────────────

  pub fn start_poll_loop(
      conn_id: String,
      handle: RusshHandle,
      app: AppHandle,
  ) -> tokio::task::AbortHandle {
      let jh = tokio::spawn(async move {
          run_monitor(conn_id, handle, app).await;
      });
      jh.abort_handle()
  }

  async fn run_monitor(conn_id: String, handle: RusshHandle, app: AppHandle) {
      // Platform check
      let check = exec_cmd(&handle, "test -f /proc/stat && echo ok").await
          .unwrap_or_default();
      if check.trim() != "ok" {
          let _ = app.emit(EV_UNSUPPORTED, &conn_id);
          return;
      }

      let mut prev: Option<PrevState> = None;

      loop {
          sleep(POLL_INTERVAL).await;

          let output = match exec_cmd(&handle, POLL_CMD).await {
              Ok(o) => o,
              Err(_) => continue,
          };

          let now = std::time::Instant::now();
          let ts = std::time::SystemTime::now()
              .duration_since(std::time::UNIX_EPOCH)
              .unwrap_or_default()
              .as_millis() as u64;

          let curr_cpu   = parse_cpu_ticks(extract_section(&output, "STAT"));
          let curr_net   = parse_netdev_raw(extract_section(&output, "NET"));
          let curr_disk  = parse_diskstats_raw(extract_section(&output, "DISKIO"));

          let (cpu, network, disk_io) = if let Some(ref p) = prev {
              let elapsed = now.duration_since(p.ts).as_secs_f64().max(0.001);
              (
                  Some(cpu_delta(&p.cpu_ticks, &curr_cpu)),
                  net_delta(&p.net, &curr_net, elapsed),
                  diskio_delta(&p.disk_io, &curr_disk, elapsed),
              )
          } else {
              (None, vec![], DiskIo::default())
          };

          let snapshot = MonitorSnapshot {
              connection_id: conn_id.clone(),
              ts,
              cpu,
              memory:    parse_meminfo(extract_section(&output, "MEM")),
              network,
              processes: parse_ps(extract_section(&output, "PS")),
              disks:     parse_df(extract_section(&output, "DF")),
              disk_io,
              system:    parse_uptime_uname(extract_section(&output, "UPTIME")),
          };

          prev = Some(PrevState {
              cpu_ticks: curr_cpu,
              net: curr_net,
              disk_io: curr_disk,
              ts: now,
          });

          let _ = app.emit(EV_SNAPSHOT, &snapshot);
      }
  }
  ```

- [ ] **Step 3: Verify compiles**

  ```bash
  cd src-tauri && cargo check 2>&1 | head -40
  ```

  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src-tauri/src/monitor/mod.rs src-tauri/src/lib.rs
  git commit -m "feat(monitor): add monitor backend — parse functions and poll loop"
  ```

---

### Task 3: MonitorManager + IPC commands + main.rs registration

**Files:**
- Create: `src-tauri/src/monitor/manager.rs`
- Create: `src-tauri/src/ipc/monitor.rs`
- Modify: `src-tauri/src/monitor/mod.rs` (add `pub mod manager;`)
- Modify: `src-tauri/src/ipc/mod.rs` (add `pub mod monitor;`)
- Modify: `src-tauri/src/main.rs` (register commands + MonitorManager state)

**Interfaces:**
- Consumes: `start_poll_loop` from Task 2
- Consumes: `SessionManager::get_ssh_handle(id) -> Option<RusshHandle>` (already exists)
- Produces: `pub struct MonitorManager` with `start()` / `stop()` / `new()`
- Produces: Tauri commands `start_monitor`, `stop_monitor`

- [ ] **Step 1: Create `src-tauri/src/monitor/manager.rs`**

  ```rust
  use crate::session::ConnectionId;
  use std::collections::HashMap;
  use tokio::sync::Mutex;

  pub struct MonitorManager {
      tasks: Mutex<HashMap<ConnectionId, tokio::task::AbortHandle>>,
  }

  impl MonitorManager {
      pub fn new() -> Self {
          Self { tasks: Mutex::new(HashMap::new()) }
      }

      pub async fn start(
          &self,
          conn_id: ConnectionId,
          handle: crate::protocol::RusshHandle,
          app: tauri::AppHandle,
      ) {
          let mut map = self.tasks.lock().await;
          // Stop existing task for this connection if any
          if let Some(old) = map.remove(&conn_id) {
              old.abort();
          }
          let abort = super::start_poll_loop(conn_id.to_string(), handle, app);
          map.insert(conn_id, abort);
      }

      pub async fn stop(&self, conn_id: ConnectionId) {
          let mut map = self.tasks.lock().await;
          if let Some(handle) = map.remove(&conn_id) {
              handle.abort();
          }
      }
  }
  ```

- [ ] **Step 2: Add `pub mod manager;` to `src-tauri/src/monitor/mod.rs`**

  Add at the top of the file (before `use` statements):

  ```rust
  pub mod manager;
  ```

- [ ] **Step 3: Create `src-tauri/src/ipc/monitor.rs`**

  ```rust
  use crate::monitor::manager::MonitorManager;
  use crate::session::{ConnectionId, SessionId};
  use crate::session::manager::SessionManager;
  use crate::error::{Error, Result};
  use tauri::{AppHandle, State};

  #[tauri::command]
  pub async fn start_monitor(
      id: SessionId,
      app: AppHandle,
      mgr: State<'_, SessionManager>,
      monitor_mgr: State<'_, MonitorManager>,
  ) -> Result<()> {
      let ssh_handle = mgr.get_ssh_handle(id).await
          .ok_or_else(|| Error::Protocol("not an SSH session".into()))?;
      monitor_mgr.start(id, ssh_handle, app).await;
      Ok(())
  }

  #[tauri::command]
  pub async fn stop_monitor(
      id: SessionId,
      monitor_mgr: State<'_, MonitorManager>,
  ) -> Result<()> {
      monitor_mgr.stop(id).await;
      Ok(())
  }
  ```

- [ ] **Step 4: Add `pub mod monitor;` to `src-tauri/src/ipc/mod.rs`**

  Append to `src-tauri/src/ipc/mod.rs`:

  ```rust
  pub mod monitor;
  ```

- [ ] **Step 5: Register in `src-tauri/src/main.rs`**

  Add `use shellx::monitor::manager::MonitorManager;` to the imports.

  Add `.manage(MonitorManager::new())` after `.manage(settings_store)`.

  Add `ipc::monitor::start_monitor,` and `ipc::monitor::stop_monitor,` to the `invoke_handler!` list.

  Full diff sections:

  ```rust
  // Add import near top with other use statements:
  use shellx::monitor::manager::MonitorManager;
  ```

  ```rust
  // In tauri::Builder::default() chain, after:
  .manage(settings_store)
  // Add:
  .manage(MonitorManager::new())
  ```

  ```rust
  // In tauri::generate_handler![...], add two lines:
  ipc::monitor::start_monitor,
  ipc::monitor::stop_monitor,
  ```

- [ ] **Step 6: Verify compiles**

  ```bash
  cd src-tauri && cargo check 2>&1 | head -40
  ```

  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src-tauri/src/monitor/manager.rs src-tauri/src/monitor/mod.rs \
    src-tauri/src/ipc/monitor.rs src-tauri/src/ipc/mod.rs src-tauri/src/main.rs
  git commit -m "feat(monitor): MonitorManager, IPC commands, main.rs registration"
  ```

---

### Task 4: Frontend types + IPC wrappers + Zustand store

**Files:**
- Create: `src/types/monitor.ts`
- Create: `src/ipc/monitor.ts`
- Create: `src/state/monitor.ts`

**Interfaces:**
- Produces: `MonitorSnapshot`, `CpuInfo`, `MemInfo`, `NetworkInfo`, `ProcessRow`, `DiskMount`, `DiskIo`, `SystemInfo` interfaces
- Produces: `startMonitor(connId)`, `stopMonitor(connId)`, `onMonitorSnapshot(cb)`, `onMonitorUnsupported(cb)`
- Produces: `useMonitorStore` with `snapshots`, `push()`, `clear()`

- [ ] **Step 1: Create `src/types/monitor.ts`**

  ```typescript
  export interface CpuInfo {
    totalPct: number;
    corePct: number[];
  }

  export interface MemInfo {
    totalKb: number;
    usedKb: number;
    cachedKb: number;
    freeKb: number;
    swapTotalKb: number;
    swapUsedKb: number;
  }

  export interface NetworkInfo {
    iface: string;
    rxBytesPerSec: number;
    txBytesPerSec: number;
  }

  export interface ProcessRow {
    pid: number;
    cpuPct: number;
    memPct: number;
    name: string;
  }

  export interface DiskMount {
    target: string;
    sizeMb: number;
    usedMb: number;
    availMb: number;
    usePct: number;
  }

  export interface DiskIo {
    readBytesPerSec: number;
    writeBytesPerSec: number;
  }

  export interface SystemInfo {
    hostname: string;
    os: string;
    kernel: string;
    arch: string;
    uptimeSecs: number;
  }

  export interface MonitorSnapshot {
    connectionId: string;
    ts: number;
    cpu: CpuInfo | null;
    memory: MemInfo;
    network: NetworkInfo[];
    processes: ProcessRow[];
    disks: DiskMount[];
    diskIo: DiskIo;
    system: SystemInfo;
  }
  ```

- [ ] **Step 2: Create `src/ipc/monitor.ts`**

  ```typescript
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import type { MonitorSnapshot } from "../types/monitor";

  export async function startMonitor(connId: string): Promise<void> {
    await invoke("start_monitor", { id: connId });
  }

  export async function stopMonitor(connId: string): Promise<void> {
    await invoke("stop_monitor", { id: connId });
  }

  export async function onMonitorSnapshot(
    cb: (snap: MonitorSnapshot) => void
  ): Promise<() => void> {
    return listen<MonitorSnapshot>("monitor:snapshot", (ev) => cb(ev.payload));
  }

  export async function onMonitorUnsupported(
    cb: (connId: string) => void
  ): Promise<() => void> {
    return listen<string>("monitor:unsupported", (ev) => cb(ev.payload));
  }
  ```

- [ ] **Step 3: Create `src/state/monitor.ts`**

  ```typescript
  import { create } from "zustand";
  import type { MonitorSnapshot } from "../types/monitor";

  const MAX_HISTORY = 60;

  interface MonitorState {
    snapshots: Record<string, MonitorSnapshot[]>;
    push: (snap: MonitorSnapshot) => void;
    clear: (connId: string) => void;
  }

  export const useMonitorStore = create<MonitorState>((set) => ({
    snapshots: {},
    push(snap) {
      set((s) => {
        const existing = s.snapshots[snap.connectionId] ?? [];
        const next = [...existing, snap].slice(-MAX_HISTORY);
        return { snapshots: { ...s.snapshots, [snap.connectionId]: next } };
      });
    },
    clear(connId) {
      set((s) => {
        const { [connId]: _dropped, ...rest } = s.snapshots;
        return { snapshots: rest };
      });
    },
  }));
  ```

- [ ] **Step 4: Type-check**

  ```bash
  pnpm tsc --noEmit 2>&1 | head -30
  ```

  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/types/monitor.ts src/ipc/monitor.ts src/state/monitor.ts
  git commit -m "feat(monitor): frontend types, IPC wrappers, and Zustand store"
  ```

---

### Task 5: Monitor UI sub-components

**Files:**
- Create: `src/components/monitor/Sparkline.tsx`
- Create: `src/components/monitor/HostInfoCard.tsx`
- Create: `src/components/monitor/PerformanceTab.tsx`
- Create: `src/components/monitor/ProcessTab.tsx`
- Create: `src/components/monitor/DiskTab.tsx`

**Interfaces:**
- Consumes: all types from `src/types/monitor.ts` (Task 4)
- Produces: `<Sparkline data color fill height width? />`, `<HostInfoCard system />`, `<PerformanceTab snapshots />`, `<ProcessTab processes />`, `<DiskTab disks diskIo snapshots />`

- [ ] **Step 1: Create `src/components/monitor/Sparkline.tsx`**

  ```tsx
  interface SparklineProps {
    data: number[];
    color: string;
    fill: string;
    height: number;
    width?: number;
  }

  export function Sparkline({ data, color, fill, height, width = 120 }: SparklineProps) {
    if (data.length < 2) {
      return <svg width={width} height={height} />;
    }
    const min = 0;
    const max = Math.max(...data, 0.001);
    const coords = data.map((v, i) => ({
      x: (i / (data.length - 1)) * width,
      y: height - ((v - min) / (max - min)) * (height - 2) - 1,
    }));
    const linePoints = coords.map((p) => `${p.x},${p.y}`).join(" ");
    const areaPath =
      `M 0,${height} ` +
      coords.map((p) => `L ${p.x},${p.y}`).join(" ") +
      ` L ${width},${height} Z`;
    return (
      <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
        <path d={areaPath} fill={fill} />
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    );
  }
  ```

- [ ] **Step 2: Create `src/components/monitor/HostInfoCard.tsx`**

  ```tsx
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
  ```

- [ ] **Step 3: Create `src/components/monitor/PerformanceTab.tsx`**

  ```tsx
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
  ```

- [ ] **Step 4: Create `src/components/monitor/ProcessTab.tsx`**

  ```tsx
  import type { ProcessRow } from "../../types/monitor";

  interface Props { processes: ProcessRow[] }

  export function ProcessTab({ processes }: Props) {
    if (processes.length === 0) {
      return (
        <div style={{ padding: 24, color: "var(--text-3)", fontSize: 13 }}>
          正在采集数据…
        </div>
      );
    }

    const topCpuPid = processes[0]?.pid;
    const topMemPid = [...processes].sort((a, b) => b.memPct - a.memPct)[0]?.pid;

    return (
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{
          width: "100%", borderCollapse: "collapse",
          fontSize: "var(--font-ui-size)", tableLayout: "fixed",
        }}>
          <colgroup>
            <col style={{ width: 64 }} />
            <col style={{ width: 72 }} />
            <col style={{ width: 72 }} />
            <col />
          </colgroup>
          <thead>
            <tr style={{ background: "var(--panel-1)", position: "sticky", top: 0 }}>
              {["PID", "CPU%", "MEM%", "进程"].map((h) => (
                <th key={h} style={{
                  padding: "6px 10px", textAlign: "left",
                  fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4,
                  color: "var(--text-3)", borderBottom: "1px solid var(--border)",
                  fontWeight: 500,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processes.map((p) => (
              <tr key={p.pid} style={{
                borderBottom: "0.5px solid var(--border)",
              }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "var(--border)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = "transparent";
                }}
              >
                <td style={{ padding: "4px 10px", color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>
                  {p.pid}
                </td>
                <td style={{ padding: "4px 10px", fontVariantNumeric: "tabular-nums" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {p.cpuPct.toFixed(1)}%
                    {p.pid === topCpuPid && (
                      <span style={{
                        fontSize: 9, padding: "1px 4px", borderRadius: 3,
                        background: "rgba(100,149,237,0.2)", color: "#6495ed",
                        textTransform: "uppercase",
                      }}>CPU</span>
                    )}
                  </span>
                </td>
                <td style={{ padding: "4px 10px", fontVariantNumeric: "tabular-nums" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {p.memPct.toFixed(1)}%
                    {p.pid === topMemPid && (
                      <span style={{
                        fontSize: 9, padding: "1px 4px", borderRadius: 3,
                        background: "rgba(76,175,80,0.2)", color: "#4caf50",
                        textTransform: "uppercase",
                      }}>MEM</span>
                    )}
                  </span>
                </td>
                <td style={{
                  padding: "4px 10px", color: "var(--text-1)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {p.name}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  ```

- [ ] **Step 5: Create `src/components/monitor/DiskTab.tsx`**

  ```tsx
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
  ```

- [ ] **Step 6: Type-check**

  ```bash
  pnpm tsc --noEmit 2>&1 | head -30
  ```

  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/components/monitor/
  git commit -m "feat(monitor): Sparkline, HostInfoCard, PerformanceTab, ProcessTab, DiskTab"
  ```

---

### Task 6: MonitorPanel + App.tsx wiring

**Files:**
- Create: `src/components/MonitorPanel.tsx`
- Modify: `src/types/connection.ts` (add `"monitor"` to `ActivityKind`)
- Modify: `src/components/ActivityToolbar.tsx` (add monitor icon)
- Modify: `src/App.tsx` (availableTabs + MonitorPanel render)

**Interfaces:**
- Consumes: all monitor sub-components (Task 5), IPC (Task 4), store (Task 4)
- Produces: `<MonitorPanel connectionId />` — self-contained, starts/stops polling on mount/unmount

- [ ] **Step 1: Create `src/components/MonitorPanel.tsx`**

  ```tsx
  import { useEffect, useState } from "react";
  import { useMonitorStore } from "../state/monitor";
  import { startMonitor, stopMonitor, onMonitorSnapshot, onMonitorUnsupported } from "../ipc/monitor";
  import { HostInfoCard } from "./monitor/HostInfoCard";
  import { PerformanceTab } from "./monitor/PerformanceTab";
  import { ProcessTab } from "./monitor/ProcessTab";
  import { DiskTab } from "./monitor/DiskTab";
  import type { MonitorSnapshot } from "../types/monitor";

  type SubTab = "performance" | "process" | "disk";

  const EMPTY_SYSTEM = { hostname: "", os: "", kernel: "", arch: "", uptimeSecs: 0 };
  const EMPTY_DISK_IO = { readBytesPerSec: 0, writeBytesPerSec: 0 };

  interface Props { connectionId: string }

  export function MonitorPanel({ connectionId }: Props) {
    const [subTab, setSubTab] = useState<SubTab>("performance");
    const [unsupported, setUnsupported] = useState(false);
    const snapshots = useMonitorStore((s) => s.snapshots[connectionId] ?? []);
    const latest = snapshots[snapshots.length - 1];

    useEffect(() => {
      let unlistenSnap: (() => void) | undefined;
      let unlistenUnsup: (() => void) | undefined;
      let cancelled = false;

      void startMonitor(connectionId).catch(() => {});

      onMonitorSnapshot((snap: MonitorSnapshot) => {
        if (snap.connectionId === connectionId) {
          useMonitorStore.getState().push(snap);
        }
      }).then((u) => {
        if (cancelled) { u(); return; }
        unlistenSnap = u;
      });

      onMonitorUnsupported((id: string) => {
        if (id === connectionId) setUnsupported(true);
      }).then((u) => {
        if (cancelled) { u(); return; }
        unlistenUnsup = u;
      });

      return () => {
        cancelled = true;
        void stopMonitor(connectionId).catch(() => {});
        unlistenSnap?.();
        unlistenUnsup?.();
        useMonitorStore.getState().clear(connectionId);
      };
    }, [connectionId]);

    if (unsupported) {
      return (
        <div style={{
          height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-3)", fontSize: 13, flexDirection: "column", gap: 8,
        }}>
          <span style={{ fontSize: 24 }}>⚠</span>
          当前主机不支持监控（仅支持 Linux）
        </div>
      );
    }

    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--panel-2)" }}>
        <HostInfoCard system={latest?.system ?? EMPTY_SYSTEM} />

        {/* Sub-tab bar */}
        <div style={{
          height: 36, padding: "0 12px", display: "flex", alignItems: "center",
          gap: 4, background: "var(--panel-1)", borderBottom: "1px solid var(--border)",
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
  ```

- [ ] **Step 2: Add `"monitor"` to `ActivityKind` in `src/types/connection.ts`**

  Change line 3 from:
  ```typescript
  export type ActivityKind = "terminal" | "files" | "tunnel";
  ```
  to:
  ```typescript
  export type ActivityKind = "terminal" | "files" | "tunnel" | "monitor";
  ```

- [ ] **Step 3: Add monitor icon to `src/components/ActivityToolbar.tsx`**

  Add `Activity` to the lucide-react import (line 1):
  ```tsx
  import { Monitor, Folder, Network, Activity } from "lucide-react";
  ```

  Add monitor entry to `ACTIVITY_ICONS` (after the `tunnel` entry):
  ```tsx
  monitor: <Activity size={12} />,
  ```

- [ ] **Step 4: Add monitor tab to `availableTabs` in `src/App.tsx`**

  Find the `availableTabs` declaration (around line 78) and add `{ id: "monitor", label: "Monitor" }` to the two non-tunnels_only SSH arrays:

  Change:
  ```tsx
  : mode === "term_tunnels"
  ? [
      { id: "terminal", label: "Terminal" },
      { id: "files", label: "Files" },
      { id: "tunnel", label: "Tunnels" },
    ]
  : [
      { id: "terminal", label: "Terminal" },
      { id: "files", label: "Files" },
    ];
  ```

  To:
  ```tsx
  : mode === "term_tunnels"
  ? [
      { id: "terminal", label: "Terminal" },
      { id: "files", label: "Files" },
      { id: "tunnel", label: "Tunnels" },
      { id: "monitor", label: "Monitor" },
    ]
  : [
      { id: "terminal", label: "Terminal" },
      { id: "files", label: "Files" },
      { id: "monitor", label: "Monitor" },
    ];
  ```

- [ ] **Step 5: Render `MonitorPanel` in `src/App.tsx`**

  Add import at the top of `src/App.tsx`:
  ```tsx
  import { MonitorPanel } from "./components/MonitorPanel";
  ```

  After the `TunnelsPanel` block (around line 534), add:
  ```tsx
  {effectiveActivity === "monitor" && activeId && activeSession?.kind === "ssh" && (
    <div style={{ position: "absolute", inset: 0 }}>
      <MonitorPanel connectionId={activeId} />
    </div>
  )}
  ```

- [ ] **Step 6: Type-check**

  ```bash
  pnpm tsc --noEmit 2>&1 | head -30
  ```

  Expected: no errors (particularly no exhaustiveness errors on `ActivityKind` switch/if-chains — the only switch in ActivityToolbar.tsx now handles "monitor").

- [ ] **Step 7: Verify Rust still compiles**

  ```bash
  cd src-tauri && cargo check 2>&1 | head -20
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/components/MonitorPanel.tsx src/types/connection.ts \
    src/components/ActivityToolbar.tsx src/App.tsx
  git commit -m "feat(monitor): MonitorPanel, App.tsx wiring, ActivityToolbar monitor tab"
  ```

---

## Self-review

**Spec coverage check:**
- ✅ SSH exec channel separate from PTY — `exec_cmd` opens its own session channel
- ✅ Platform check (`test -f /proc/stat`) before polling
- ✅ `monitor:unsupported` event + Chinese error message in UI
- ✅ 3-second poll interval (`POLL_INTERVAL`)
- ✅ 60-snapshot history (`MAX_HISTORY = 60`)
- ✅ `cpu: null` on first poll (no prev state)
- ✅ CPU % via tick delta (`cpu_delta`)
- ✅ Memory, network, processes, disk mounts, disk I/O — all parsed
- ✅ Per-interface network delta with loopback excluded
- ✅ Process list top-50, view-only, no kill buttons
- ✅ Disk color: green <60%, orange 60-80%, red ≥80%
- ✅ SVG sparklines, no external deps
- ✅ MonitorManager start/stop + AbortHandle
- ✅ MonitorPanel mounts/unmounts with poll start/stop
- ✅ Monitor tab visible only for `kind === "ssh"` sessions
- ✅ Tab not visible for `tunnels_only` mode

**Type consistency check:**
- `MonitorSnapshot.connectionId` (camelCase TS) ↔ `connection_id` (snake_case Rust, serde camelCase) ✅
- `diskIo` (TS) ↔ `disk_io` serialized as `diskIo` via `#[serde(rename_all = "camelCase")]` ✅
- `startMonitor` / `stopMonitor` invoke with `{ id: connId }` ↔ Rust command param `id: SessionId` ✅
- `onMonitorSnapshot` filter by `snap.connectionId === connectionId` matches backend emit ✅

**Placeholder check:** None. All code blocks are complete.

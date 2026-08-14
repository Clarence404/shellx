pub mod manager;

use crate::protocol::ssh::exec_cmd;
use crate::protocol::RusshHandle;
use serde::Serialize;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::time::{sleep, Duration};

pub const EV_SNAPSHOT: &str = "monitor:snapshot";
pub const EV_UNSUPPORTED: &str = "monitor:unsupported";

pub const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(2);

const POLL_CMD: &str = concat!(
    "echo '---STAT---'; cat /proc/stat; ",
    "echo '---MEM---'; cat /proc/meminfo; ",
    "echo '---NET---'; cat /proc/net/dev; ",
    "echo '---PS---'; ps -eo pid,pcpu,pmem,comm --sort=-%cpu --no-headers 2>/dev/null | head -50; ",
    "echo '---DF---'; df -Pl 2>/dev/null; ",
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
    let rest = output[start..].trim_start_matches('\n');
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
        "T" => (n * 1_048_576.0) as u64,
        "G" => (n * 1_024.0) as u64,
        "M" => n as u64,
        "K" => (n / 1_024.0) as u64,
        _ => s.parse::<f64>().unwrap_or(0.0) as u64 / 1_048_576,
    }
}

fn parse_df(section: &str) -> Vec<DiskMount> {
    section.lines().skip(1)
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| {
            let p: Vec<&str> = l.split_whitespace().collect();
            if p.len() < 6 { return None; }
            if !p[0].starts_with("/dev/") { return None; }
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
    interval: Duration,
) -> tokio::task::AbortHandle {
    let jh = tokio::spawn(async move {
        run_monitor(conn_id, handle, app, interval).await;
    });
    jh.abort_handle()
}

async fn run_monitor(conn_id: String, handle: RusshHandle, app: AppHandle, interval: Duration) {
    // Platform check
    let check = exec_cmd(&handle, "test -f /proc/stat && echo ok").await
        .unwrap_or_default();
    if check.trim() != "ok" {
        let _ = app.emit(EV_UNSUPPORTED, &conn_id);
        return;
    }

    let mut prev: Option<PrevState> = None;
    let mut err_count: u8 = 0;

    loop {
        let output = match exec_cmd(&handle, POLL_CMD).await {
            Ok(o) => { err_count = 0; o }
            Err(_) => {
                err_count += 1;
                if err_count >= 3 { break; }
                sleep(interval).await;
                continue;
            }
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
        sleep(interval).await;
    }
}

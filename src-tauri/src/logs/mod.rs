//! Structured application logging.
//!
//! Provides a single append point (`log()`) that every subsystem uses to
//! record what it's doing. Every entry lands in two places:
//!
//! 1. **In-memory ring buffer** (10k entries) — cheap to read from
//!    Tauri commands (`logs_snapshot`), broadcast to live subscribers
//!    (`logs_subscribe`).
//! 2. **Daily-rotated jsonl file** at `~/.shellx/logs/YYYY-MM-DD.jsonl`
//!    — for post-mortem debugging when the app has restarted. Files
//!    older than 7 days are pruned on startup.
//!
//! Design notes:
//! - The ring buffer + broadcast channel live in `LogsStore` which is
//!   registered as tauri State so IPC commands can grab it.
//! - File writes go through an mpsc channel drained by a background
//!   task, so hot-path callers never block on disk IO.
//! - Sensitive fields (passwords, passphrases, key content) must NEVER
//!   be passed in. Callers pass only ids, labels, addresses, ports.

use chrono::{DateTime, Datelike, Local, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::{broadcast, mpsc};

const RING_CAP: usize = 10_000;
const BROADCAST_CAP: usize = 512;
const RETENTION_DAYS: i64 = 7;
const FILE_QUEUE_CAP: usize = 4096;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "debug" => Some(Level::Debug),
            "info" => Some(Level::Info),
            "warn" => Some(Level::Warn),
            "error" => Some(Level::Error),
            _ => None,
        }
    }
    fn as_severity(self) -> u8 {
        match self {
            Level::Debug => 0,
            Level::Info => 1,
            Level::Warn => 2,
            Level::Error => 3,
        }
    }
    pub fn gte(self, other: Level) -> bool {
        self.as_severity() >= other.as_severity()
    }
}

/// Category tag — kept as a plain `String` so subsystems can pass a
/// literal without needing a matching enum arm here. Convention:
/// lowercase snake_case, single word where possible.
#[allow(dead_code)]
pub mod categories {
    pub const TUNNEL: &str = "tunnel";
    pub const SESSION: &str = "session";
    pub const SFTP: &str = "sftp";
    pub const MONITOR: &str = "monitor";
    pub const HOST: &str = "host";
    pub const UPDATER: &str = "updater";
    pub const KEYCHAIN: &str = "keychain";
    pub const APP: &str = "app";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub id: u64,
    pub ts: DateTime<Utc>,
    pub level: Level,
    pub category: String,
    pub message: String,
    pub fields: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct LogFilter {
    /// Case-insensitive substring match against message + serialized
    /// fields. Empty = no filter.
    #[serde(default)]
    pub query: String,
    /// Minimum level; only entries with `entry.level.gte(min_level)`
    /// pass. Default = Debug (i.e. no filter).
    #[serde(default)]
    pub min_level: Option<Level>,
    /// If non-empty, only these categories pass.
    #[serde(default)]
    pub categories: Vec<String>,
}

impl LogFilter {
    fn matches(&self, entry: &LogEntry) -> bool {
        if let Some(min) = self.min_level {
            if !entry.level.gte(min) {
                return false;
            }
        }
        if !self.categories.is_empty() && !self.categories.iter().any(|c| c == &entry.category) {
            return false;
        }
        if !self.query.is_empty() {
            let q = self.query.to_ascii_lowercase();
            if entry.message.to_ascii_lowercase().contains(&q) {
                return true;
            }
            // Cheap-ish search across serialized fields.
            let fields_json = serde_json::to_string(&entry.fields).unwrap_or_default();
            if fields_json.to_ascii_lowercase().contains(&q) {
                return true;
            }
            return false;
        }
        true
    }
}

/// Shared state registered with tauri; readers grab it via `State<Arc<LogsStore>>`.
pub struct LogsStore {
    ring: Mutex<VecDeque<LogEntry>>,
    next_id: AtomicU64,
    tx_broadcast: broadcast::Sender<LogEntry>,
    tx_file: Option<mpsc::Sender<LogEntry>>,
    disk_enabled: std::sync::atomic::AtomicBool,
}

impl LogsStore {
    fn new(tx_file: Option<mpsc::Sender<LogEntry>>) -> Self {
        let (tx_broadcast, _) = broadcast::channel(BROADCAST_CAP);
        Self {
            ring: Mutex::new(VecDeque::with_capacity(RING_CAP)),
            next_id: AtomicU64::new(1),
            tx_broadcast,
            tx_file,
            disk_enabled: std::sync::atomic::AtomicBool::new(true),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<LogEntry> {
        self.tx_broadcast.subscribe()
    }

    pub fn set_disk_enabled(&self, enabled: bool) {
        self.disk_enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn disk_enabled(&self) -> bool {
        self.disk_enabled.load(Ordering::Relaxed)
    }

    /// Push a new entry into the ring, drop the oldest if full, then
    /// broadcast to live subscribers and enqueue for disk write.
    pub fn push(&self, level: Level, category: &str, message: impl Into<String>, fields: serde_json::Value) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let fields = match fields {
            serde_json::Value::Object(m) => m.into_iter().collect(),
            serde_json::Value::Null => BTreeMap::new(),
            other => {
                let mut m = BTreeMap::new();
                m.insert("value".to_string(), other);
                m
            }
        };
        let entry = LogEntry {
            id,
            ts: Utc::now(),
            level,
            category: category.to_string(),
            message: message.into(),
            fields,
        };

        // Ring push (drop oldest if full).
        if let Ok(mut ring) = self.ring.lock() {
            if ring.len() >= RING_CAP {
                ring.pop_front();
            }
            ring.push_back(entry.clone());
        }

        // Broadcast — errors mean no subscribers, which is fine.
        let _ = self.tx_broadcast.send(entry.clone());

        // Enqueue file write (best-effort; drop if queue is full).
        if self.disk_enabled() {
            if let Some(tx) = &self.tx_file {
                let _ = tx.try_send(entry);
            }
        }
    }

    /// Return a paginated snapshot of entries matching `filter`, newest
    /// first. `after_id` (exclusive lower bound) lets callers request
    /// only entries newer than what they already have.
    pub fn snapshot(&self, filter: &LogFilter, limit: usize, after_id: Option<u64>) -> Vec<LogEntry> {
        let ring = match self.ring.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let mut out = Vec::with_capacity(limit.min(ring.len()));
        for entry in ring.iter().rev() {
            if let Some(after) = after_id {
                if entry.id <= after {
                    continue;
                }
            }
            if filter.matches(entry) {
                out.push(entry.clone());
                if out.len() >= limit {
                    break;
                }
            }
        }
        out
    }

    /// Count entries per level and total, honouring the filter's
    /// category + query but ignoring min_level (so the stats bar can
    /// show "1 warn · 2 error · 158 total" independent of the current
    /// level cutoff).
    pub fn stats(&self, filter: &LogFilter) -> LogsStats {
        let ring = match self.ring.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let mut stats = LogsStats::default();
        let stripped = LogFilter {
            query: filter.query.clone(),
            min_level: None,
            categories: filter.categories.clone(),
        };
        for e in ring.iter() {
            if !stripped.matches(e) {
                continue;
            }
            stats.total += 1;
            match e.level {
                Level::Debug => stats.debug += 1,
                Level::Info => stats.info += 1,
                Level::Warn => stats.warn += 1,
                Level::Error => stats.error += 1,
            }
        }
        stats
    }
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct LogsStats {
    pub total: u64,
    pub debug: u64,
    pub info: u64,
    pub warn: u64,
    pub error: u64,
}

/// Global singleton — set once at startup so log-emitting call sites
/// don't need a `State<>` handle threaded through every function.
static GLOBAL: OnceLock<Arc<LogsStore>> = OnceLock::new();

pub fn store() -> Option<Arc<LogsStore>> {
    GLOBAL.get().cloned()
}

/// Front-door for every log call in the codebase.
pub fn log(level: Level, category: &str, message: impl Into<String>, fields: serde_json::Value) {
    if let Some(s) = GLOBAL.get() {
        s.push(level, category, message, fields);
    }
}

#[macro_export]
macro_rules! log_info {
    ($cat:expr, $msg:expr $(, $($rest:tt)*)?) => {
        $crate::logs::log($crate::logs::Level::Info, $cat, $msg, serde_json::json!({ $($($rest)*)? }))
    };
}
#[macro_export]
macro_rules! log_warn {
    ($cat:expr, $msg:expr $(, $($rest:tt)*)?) => {
        $crate::logs::log($crate::logs::Level::Warn, $cat, $msg, serde_json::json!({ $($($rest)*)? }))
    };
}
#[macro_export]
macro_rules! log_error {
    ($cat:expr, $msg:expr $(, $($rest:tt)*)?) => {
        $crate::logs::log($crate::logs::Level::Error, $cat, $msg, serde_json::json!({ $($($rest)*)? }))
    };
}
#[macro_export]
macro_rules! log_debug {
    ($cat:expr, $msg:expr $(, $($rest:tt)*)?) => {
        $crate::logs::log($crate::logs::Level::Debug, $cat, $msg, serde_json::json!({ $($($rest)*)? }))
    };
}

/// Initialise the logs subsystem. Called once at startup from `main.rs`
/// after the config dir is known. Sets up the ring + broadcast channel,
/// spawns the file-writer task, and prunes files older than 7 days.
pub fn init(config_dir: PathBuf) -> Arc<LogsStore> {
    let logs_dir = config_dir.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    prune_old_files(&logs_dir);

    let (tx_file, rx_file) = mpsc::channel::<LogEntry>(FILE_QUEUE_CAP);
    let store = Arc::new(LogsStore::new(Some(tx_file)));
    // tauri::async_runtime::spawn works whether the caller is already
    // inside the Tokio runtime or not — needed because setup() may be
    // invoked from a thread that hasn't entered the runtime yet.
    tauri::async_runtime::spawn(file_writer_loop(logs_dir, rx_file));

    if GLOBAL.set(store.clone()).is_err() {
        // Already initialised — return the existing one so callers still get a handle.
        return GLOBAL.get().cloned().expect("global logs store");
    }
    // Emit an "app started" log so the ring isn't empty on first open.
    store.push(
        Level::Info,
        categories::APP,
        "logs subsystem initialised",
        serde_json::json!({ "ring_cap": RING_CAP, "retention_days": RETENTION_DAYS }),
    );
    store
}

async fn file_writer_loop(logs_dir: PathBuf, mut rx: mpsc::Receiver<LogEntry>) {
    use tokio::io::AsyncWriteExt;
    let mut current_day: Option<String> = None;
    let mut current_file: Option<tokio::fs::File> = None;

    while let Some(entry) = rx.recv().await {
        let local: DateTime<Local> = entry.ts.into();
        let day = format!("{:04}-{:02}-{:02}", local.year(), local.month(), local.day());
        if current_day.as_deref() != Some(day.as_str()) {
            let path = logs_dir.join(format!("{day}.jsonl"));
            match tokio::fs::OpenOptions::new().create(true).append(true).open(&path).await {
                Ok(f) => {
                    current_file = Some(f);
                    current_day = Some(day);
                }
                Err(_) => {
                    // Give up on this line but keep the loop alive.
                    continue;
                }
            }
        }
        if let Some(f) = current_file.as_mut() {
            if let Ok(mut line) = serde_json::to_vec(&entry) {
                line.push(b'\n');
                let _ = f.write_all(&line).await;
                // Flush per-line — logs are low volume and the safety is worth it.
                let _ = f.flush().await;
            }
        }
    }
}

fn prune_old_files(logs_dir: &PathBuf) {
    let cutoff = Utc::now() - chrono::Duration::days(RETENTION_DAYS);
    let cutoff_local: DateTime<Local> = cutoff.into();
    let cutoff_key = format!(
        "{:04}-{:02}-{:02}",
        cutoff_local.year(),
        cutoff_local.month(),
        cutoff_local.day(),
    );
    let Ok(entries) = std::fs::read_dir(logs_dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(stem) = name.strip_suffix(".jsonl") else { continue };
        // Simple lexical compare works because all names are YYYY-MM-DD.
        if stem < cutoff_key.as_str() {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

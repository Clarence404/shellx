use crate::sshconfig::{self, ScanResult};

/// The account ssh would fall back to when a `Host` block names no `User`.
/// Not authoritative — it is a guess, and the scan flags it as one — so an
/// empty environment degrades to a blank field rather than an error.
fn local_user() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .or_else(|_| std::env::var("LOGNAME"))
        .unwrap_or_default()
}

/// Reads `~/.ssh/config` (or an explicit path) and returns what it found.
/// Never fails on a missing file: `exists: false` with empty lists is the
/// honest answer for someone who has never written one.
#[tauri::command]
pub fn ssh_config_scan(path: Option<String>) -> ScanResult {
    let target = match path {
        Some(p) => Some(std::path::PathBuf::from(p)),
        None => sshconfig::default_path(),
    };
    match target {
        Some(p) => {
            let result = sshconfig::scan(&p, &local_user());
            crate::log_info!(
                crate::logs::categories::HOST,
                "scanned ssh config",
                "path": result.path,
                "exists": result.exists,
                "hosts": result.hosts.len(),
                "skipped": result.skipped.len(),
            );
            result
        }
        None => ScanResult {
            path: String::new(),
            exists: false,
            hosts: Vec::new(),
            skipped: Vec::new(),
        },
    }
}

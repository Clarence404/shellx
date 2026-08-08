//! Host-key TOFU verification backed by the OpenSSH known_hosts file (D1).
//! Append-only discipline (D2): learn() only ever appends; check() never
//! writes. Hashed `|1|…` lines are matched by russh's helper but we never
//! produce them.

use crate::error::{Error, Result};
use russh::keys::PublicKey;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum Verdict {
    Match,
    Unknown,
    Mismatch { stored_fingerprint: String },
}

#[derive(Serialize, Clone, Debug)]
pub struct TrustedHost {
    pub host: String,
    pub key_type: String,
    pub fingerprint: String,
}

pub fn default_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("known_hosts"))
}

pub fn check(host: &str, port: u16, key: &PublicKey, path: &Path) -> Verdict {
    if !path.exists() {
        return Verdict::Unknown;
    }
    match russh::keys::check_known_hosts_path(host, port, key, path) {
        Ok(true) => Verdict::Match,
        Ok(false) => Verdict::Unknown,
        // KeyChanged carries the line number; re-read it to fingerprint the stored key.
        Err(russh::keys::Error::KeyChanged { line }) => Verdict::Mismatch {
            stored_fingerprint: stored_fingerprint_at(path, line)
                .unwrap_or_else(|| "unknown".into()),
        },
        // Unreadable / malformed file → treat as Unknown per spec §4 (never
        // block the connect path on a parse error; the dialog will note that
        // trust can't be persisted if learn() also fails).
        Err(_) => Verdict::Unknown,
    }
}

pub fn learn(host: &str, port: u16, key: &PublicKey, path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| Error::Protocol(format!("create {}: {e}", parent.display())))?;
    }
    // learn_known_hosts_path appends (OpenSSH semantics). 0600 on unix for a
    // freshly created file.
    russh::keys::known_hosts::learn_known_hosts_path(host, port, key, path)
        .map_err(|e| Error::Protocol(format!("known_hosts append: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perm = meta.permissions();
            perm.set_mode(0o600);
            let _ = std::fs::set_permissions(path, perm);
        }
    }
    Ok(())
}

fn stored_fingerprint_at(path: &Path, line: usize) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let l = content.lines().nth(line.saturating_sub(1))?;
    let b64 = l.split_whitespace().nth(2)?;
    let key = russh::keys::parse_public_key_base64(b64).ok()?;
    Some(format!("{}", key.fingerprint(russh::keys::HashAlg::Sha256)))
}

/// Read-only listing for the Settings "Trusted servers" view (D14).
/// Hashed entries are shown as "(hashed)" hosts; unparsable lines skipped.
pub fn list(path: &Path) -> Vec<TrustedHost> {
    let Ok(content) = std::fs::read_to_string(path) else { return Vec::new(); };
    content.lines().filter_map(|l| {
        let l = l.trim();
        if l.is_empty() || l.starts_with('#') { return None; }
        let mut parts = l.split_whitespace();
        let host_field = parts.next()?;
        let key_type = parts.next()?.to_string();
        let b64 = parts.next()?;
        let key = russh::keys::parse_public_key_base64(b64).ok()?;
        let host = if host_field.starts_with("|1|") { "(hashed)".to_string() }
                   else { host_field.split(',').next().unwrap_or(host_field).to_string() };
        Some(TrustedHost {
            host,
            key_type,
            fingerprint: format!("{}", key.fingerprint(russh::keys::HashAlg::Sha256)),
        })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // A real ed25519 public key line for host "example.com" port 22.
    // Generated once with ssh-keygen; the key blob is stable test data.
    const LINE: &str = "example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIw8mMfnnwxVT3jaKBrrEtQJNfcWC3fugKn47RyfV3hx test1\n";

    fn parse_key() -> russh::keys::PublicKey {
        russh::keys::parse_public_key_base64(
            "AAAAC3NzaC1lZDI1NTE5AAAAIIw8mMfnnwxVT3jaKBrrEtQJNfcWC3fugKn47RyfV3hx",
        ).unwrap()
    }

    #[test]
    fn unknown_when_file_missing() {
        let td = TempDir::new().unwrap();
        let path = td.path().join("known_hosts");
        assert!(matches!(check("example.com", 22, &parse_key(), &path), Verdict::Unknown));
    }

    #[test]
    fn match_after_learn() {
        let td = TempDir::new().unwrap();
        let path = td.path().join("known_hosts");
        learn("example.com", 22, &parse_key(), &path).unwrap();
        assert!(matches!(check("example.com", 22, &parse_key(), &path), Verdict::Match));
    }

    #[test]
    fn learn_appends_never_rewrites() {
        let td = TempDir::new().unwrap();
        let path = td.path().join("known_hosts");
        fs::write(&path, "# preexisting comment line\n").unwrap();
        learn("example.com", 22, &parse_key(), &path).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.starts_with("# preexisting comment line\n"), "existing content preserved");
        assert!(content.lines().count() >= 2);
    }

    #[test]
    fn mismatch_when_key_differs() {
        let td = TempDir::new().unwrap();
        let path = td.path().join("known_hosts");
        // Store a DIFFERENT ed25519 key for the same host.
        fs::write(&path, "example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM4aAHoSnRD6tZ4P/riPe5m1N0KvCOGhFqDdZh64rZG1 test2\n").unwrap();
        match check("example.com", 22, &parse_key(), &path) {
            Verdict::Mismatch { stored_fingerprint } => {
                assert!(stored_fingerprint.starts_with("SHA256:"));
            }
            v => panic!("expected Mismatch, got {v:?}"),
        }
    }

    #[test]
    fn list_returns_entries() {
        let td = TempDir::new().unwrap();
        let path = td.path().join("known_hosts");
        learn("example.com", 22, &parse_key(), &path).unwrap();
        let rows = list(&path);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].host, "example.com");
        assert_eq!(rows[0].key_type, "ssh-ed25519");
        assert!(rows[0].fingerprint.starts_with("SHA256:"));
    }
}

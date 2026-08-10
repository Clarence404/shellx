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
        // KeyChanged fires when a stored entry for this host has the same
        // algorithm as `key` but a different value. Re-derive the offending
        // stored key via known_host_keys_path (host-matching, incl. hashed
        // entries, handled internally by russh) rather than indexing into
        // physical file lines: russh's `line` counter only increments on
        // non-comment lines, so it does not line up with
        // `content.lines().nth(..)` when comments precede the entry.
        Err(russh::keys::Error::KeyChanged { .. }) => Verdict::Mismatch {
            stored_fingerprint: stored_fingerprint_for(host, port, key, path)
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

/// Find the stored key for `host` that caused a KeyChanged mismatch and
/// fingerprint it. `known_host_keys_path` already applies the same
/// host-matching (including hashed `|1|...` entries) that
/// `check_known_hosts_path` used internally, so this always looks at the
/// correct host's entry regardless of how many comment lines or other
/// hosts' entries precede it in the file. Mismatch is only ever raised for
/// a stored entry whose algorithm matches the presented key's, so that's
/// the entry to report.
fn stored_fingerprint_for(host: &str, port: u16, key: &PublicKey, path: &Path) -> Option<String> {
    let entries = russh::keys::known_hosts::known_host_keys_path(host, port, path).ok()?;
    let (_, recorded) = entries
        .into_iter()
        .find(|(_, recorded)| recorded.algorithm() == key.algorithm())?;
    Some(format!(
        "{}",
        recorded.fingerprint(russh::keys::HashAlg::Sha256)
    ))
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
    fn mismatch_reports_correct_hosts_key_when_comment_and_other_host_precede_it() {
        let td = TempDir::new().unwrap();
        let path = td.path().join("known_hosts");
        // Regression for: stored_fingerprint used to index into physical file
        // lines using russh's `KeyChanged { line }`, but that counter only
        // increments on non-comment lines. With a leading comment and a
        // different host's entry ahead of example.com's, the old code read
        // the wrong physical line and could report the wrong key.
        fs::write(
            &path,
            "# leading comment\n\
             other-host.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMBwc3z0GH+GXnMfbuyLXMYKHZ7di1QNTae3iOb6N5LU test3\n\
             example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM4aAHoSnRD6tZ4P/riPe5m1N0KvCOGhFqDdZh64rZG1 test2\n",
        )
        .unwrap();

        let example_com_old_key = russh::keys::parse_public_key_base64(
            "AAAAC3NzaC1lZDI1NTE5AAAAIM4aAHoSnRD6tZ4P/riPe5m1N0KvCOGhFqDdZh64rZG1",
        )
        .unwrap();
        let expected = format!(
            "{}",
            example_com_old_key.fingerprint(russh::keys::HashAlg::Sha256)
        );

        let other_host_key = russh::keys::parse_public_key_base64(
            "AAAAC3NzaC1lZDI1NTE5AAAAIMBwc3z0GH+GXnMfbuyLXMYKHZ7di1QNTae3iOb6N5LU",
        )
        .unwrap();
        let wrong = format!("{}", other_host_key.fingerprint(russh::keys::HashAlg::Sha256));

        match check("example.com", 22, &parse_key(), &path) {
            Verdict::Mismatch { stored_fingerprint } => {
                assert_eq!(
                    stored_fingerprint, expected,
                    "must report example.com's stored key, not a shifted physical line"
                );
                assert_ne!(
                    stored_fingerprint, wrong,
                    "must not report other-host.example's key"
                );
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

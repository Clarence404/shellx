//! Private-key discovery + loading (D7/D8/D9).
//! Classification reads ONLY the first line; metadata comes from the
//! embedded public part (no decryption ever happens during discovery).

use crate::error::{Error, Result};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "lowercase")]
pub enum KeyKind {
    Supported,
    Ppk,
    Ssh2,
    Unknown,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredKey {
    pub path: String,
    pub file_name: String,
    pub kind: KeyKind,
    pub algo: Option<String>,
    pub comment: Option<String>,
    pub encrypted: bool,
}

const EXCLUDED: &[&str] = &["known_hosts", "known_hosts.old", "config", "authorized_keys"];

pub fn discover(dir: &Path) -> Vec<DiscoveredKey> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if EXCLUDED.contains(&name.as_str()) || name.ends_with(".pub") {
            continue;
        }
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Ok(first) = first_line(&path) else {
            continue;
        };
        let kind = classify(&first);
        if matches!(kind, KeyKind::Unknown) {
            continue;
        }
        let (algo, comment, encrypted) = match kind {
            KeyKind::Supported => metadata(&path),
            _ => (None, None, false),
        };
        out.push(DiscoveredKey {
            path: path.to_string_lossy().replace('\\', "/"),
            file_name: name,
            kind,
            algo,
            comment,
            encrypted,
        });
    }
    out.sort_by_key(|k| match k.algo.as_deref() {
        Some("ED25519") => 0,
        Some(a) if a.starts_with("RSA") => 1,
        Some(_) => 2,
        None => 3,
    });
    out
}

fn first_line(path: &Path) -> std::io::Result<String> {
    use std::io::{BufRead, BufReader};
    let f = std::fs::File::open(path)?;
    let mut line = String::new();
    BufReader::new(f).read_line(&mut line)?;
    Ok(line)
}

fn classify(first: &str) -> KeyKind {
    let t = first.trim();
    if t.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----")
        || t.starts_with("-----BEGIN RSA PRIVATE KEY-----")
        || t.starts_with("-----BEGIN EC PRIVATE KEY-----")
        || t.starts_with("-----BEGIN DSA PRIVATE KEY-----")
        || t.starts_with("-----BEGIN PRIVATE KEY-----")
        || t.starts_with("-----BEGIN ENCRYPTED PRIVATE KEY-----")
    {
        KeyKind::Supported
    } else if t.starts_with("PuTTY-User-Key-File") {
        KeyKind::Ppk
    } else if t.starts_with("---- BEGIN SSH2") {
        KeyKind::Ssh2
    } else {
        KeyKind::Unknown
    }
}

fn metadata(path: &Path) -> (Option<String>, Option<String>, bool) {
    let Ok(content) = std::fs::read_to_string(path) else {
        return (None, None, false);
    };
    // Try OpenSSH format first — this works without decryption for encrypted
    // keys too (the public part is always readable).
    if let Ok(pk) = russh::keys::ssh_key::PrivateKey::from_openssh(&content) {
        let algo = Some(match pk.algorithm() {
            russh::keys::ssh_key::Algorithm::Ed25519 => "ED25519".to_string(),
            russh::keys::ssh_key::Algorithm::Rsa { .. } => "RSA".to_string(),
            a => format!("{a:?}").to_uppercase(),
        });
        let comment = if pk.comment().is_empty() {
            None
        } else {
            Some(pk.comment().to_string())
        };
        return (algo, comment, pk.is_encrypted());
    }
    // Non-OpenSSH PEM: encrypted iff header says so.
    let encrypted = content.contains("ENCRYPTED");
    (None, None, encrypted)
}

pub fn load(path: &Path, passphrase: Option<&str>) -> Result<russh::keys::PrivateKey> {
    match russh::keys::load_secret_key(path, passphrase) {
        Ok(k) => Ok(k),
        Err(russh::keys::Error::KeyIsEncrypted) => Err(Error::PassphraseNeeded),
        Err(e) => Err(Error::Protocol(format!(
            "load key {}: {e}",
            path.display()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // Unencrypted ed25519 test key (generated with `ssh-keygen -t ed25519 -N "" -C plan-test`).
    // Checked-in as test data — never used on a real server.
    const ED25519_PLAIN: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\n\
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n\
QyNTUxOQAAACDts7+VHRlQca5kyUBPVu2tL5DCMT6bjKiL9X//FR4Y8wAAAJDCcHY8wnB2\n\
PAAAAAtzc2gtZWQyNTUxOQAAACDts7+VHRlQca5kyUBPVu2tL5DCMT6bjKiL9X//FR4Y8w\n\
AAAEDyaRnxSvCwZAN1uWo9G0BwHhHWPVGgtN3NGv1/UCvvN+2zv5UdGVBxrmTJQE9W7a0v\n\
kMIxPpuMqIv1f/8VHhjzAAAACXBsYW4tdGVzdAECAwQ=\n\
-----END OPENSSH PRIVATE KEY-----\n";

    #[test]
    fn discovers_openssh_key_without_pub_sibling() {
        let td = TempDir::new().unwrap();
        // No .pub sibling on purpose — D7 regression guard (platform-svc case).
        fs::write(td.path().join("platform-svc"), ED25519_PLAIN).unwrap();
        let found = discover(td.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file_name, "platform-svc");
        assert!(matches!(found[0].kind, KeyKind::Supported));
        assert_eq!(found[0].algo.as_deref(), Some("ED25519"));
        assert!(!found[0].encrypted);
    }

    #[test]
    fn excludes_non_key_files() {
        let td = TempDir::new().unwrap();
        fs::write(td.path().join("known_hosts"), "x\n").unwrap();
        fs::write(td.path().join("known_hosts.old"), "x\n").unwrap();
        fs::write(td.path().join("config"), "Host x\n").unwrap();
        fs::write(td.path().join("authorized_keys"), "ssh-ed25519 AAA x\n").unwrap();
        fs::write(td.path().join("id_ed25519.pub"), "ssh-ed25519 AAA x\n").unwrap();
        fs::write(td.path().join("random.txt"), "hello\n").unwrap();
        assert!(discover(td.path()).is_empty());
    }

    #[test]
    fn classifies_ppk_and_ssh2() {
        let td = TempDir::new().unwrap();
        fs::write(
            td.path().join("putty.ppk"),
            "PuTTY-User-Key-File-3: ssh-ed25519\n...",
        )
        .unwrap();
        fs::write(
            td.path().join("tectia"),
            "---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\n...",
        )
        .unwrap();
        let found = discover(td.path());
        let ppk = found.iter().find(|k| k.file_name == "putty.ppk").unwrap();
        let ssh2 = found.iter().find(|k| k.file_name == "tectia").unwrap();
        assert!(matches!(ppk.kind, KeyKind::Ppk));
        assert!(matches!(ssh2.kind, KeyKind::Ssh2));
    }

    #[test]
    fn load_plain_key_succeeds() {
        let td = TempDir::new().unwrap();
        let p = td.path().join("k");
        fs::write(&p, ED25519_PLAIN).unwrap();
        load(&p, None).unwrap();
    }
}

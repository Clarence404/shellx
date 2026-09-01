//! The config bundle: everything shellx knows about your machines in one
//! JSON file you can carry to another computer.
//!
//! The hard rule this module exists to enforce is that **secrets never
//! leave the OS keychain**. Passwords and passphrases are not fields on
//! anything here — they cannot be, because the types have nowhere to put
//! them. What a host does carry is two booleans saying whether a secret
//! existed, so the importer can tell you which hosts will ask for one
//! again instead of letting you discover it at connect time.
//!
//! Everything in this file is pure. Reading the stores and writing the
//! rows back happens in `ipc::bundle`, which is where the async and the
//! failure modes live.

use crate::settings::Settings;
use crate::store::hosts::HostRecord;
use crate::store::tunnels::TunnelRule;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Stamped into every file so an unrelated `.json` fails fast with a
/// sentence rather than a serde error about a missing field.
pub const FORMAT: &str = "shellx.config";
/// Bumped only for a change old shellx versions could not read.
pub const VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleHost {
    /// Carried only so tunnel rules can point at their host. Import mints
    /// a fresh id — two machines' databases are not meant to share ids.
    pub id: Uuid,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub notes: Option<String>,
    pub auth_method: String,
    #[serde(default)]
    pub key_path: Option<String>,
    pub connection_mode: String,
    /// A password was in the keychain on the exporting machine. The
    /// password itself is not here and never will be.
    #[serde(default)]
    pub has_password: bool,
    /// Likewise for a stored key passphrase.
    #[serde(default)]
    pub has_passphrase: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleTunnel {
    /// Refers to a `BundleHost.id` inside this same file.
    pub host_id: Uuid,
    pub label: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub enabled: bool,
    pub bind_all: bool,
    pub auto_reconnect: bool,
    pub autostart: bool,
    pub sort_order: i32,
}

/// One saved command snippet, as it travels in a bundle. No id: on
/// import a snippet is matched by content, not identity.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BundleSnippet {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub auto_enter: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub format: String,
    pub version: u32,
    pub exported_at: i64,
    pub app_version: String,
    pub hosts: Vec<BundleHost>,
    pub tunnels: Vec<BundleTunnel>,
    /// Absent when the export left settings out — importing then touches
    /// only hosts and tunnels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<Settings>,
    /// The command-snippet library. Absent from bundles written before
    /// snippets existed — serde default keeps those importable.
    #[serde(default)]
    pub snippets: Vec<BundleSnippet>,
}

/// Whether a host in the keychain had each kind of secret. Gathered by
/// the caller so this module never touches the keychain itself.
#[derive(Clone, Copy, Debug, Default)]
pub struct SecretFlags {
    pub has_password: bool,
    pub has_passphrase: bool,
}

pub fn build(
    hosts: &[HostRecord],
    tunnels: &[TunnelRule],
    settings: Option<Settings>,
    snippets: &[crate::store::snippets::Snippet],
    flags: impl Fn(Uuid) -> SecretFlags,
    app_version: &str,
    exported_at: i64,
) -> Bundle {
    let hosts: Vec<BundleHost> = hosts
        .iter()
        .map(|h| {
            let f = flags(h.id);
            BundleHost {
                id: h.id,
                label: h.label.clone(),
                host: h.host.clone(),
                port: h.port,
                username: h.username.clone(),
                notes: h.notes.clone(),
                auth_method: h.auth_method.clone(),
                key_path: h.key_path.clone(),
                connection_mode: h.connection_mode.clone(),
                has_password: f.has_password,
                has_passphrase: f.has_passphrase,
            }
        })
        .collect();

    // A rule whose host is gone is already possible in the database
    // (deleting a host doesn't cascade), and carrying one into a bundle
    // would import a tunnel attached to nothing.
    let tunnels: Vec<BundleTunnel> = tunnels
        .iter()
        .filter(|r| hosts.iter().any(|h| h.id == r.host_id))
        .map(|r| BundleTunnel {
            host_id: r.host_id,
            label: r.label.clone(),
            local_port: r.local_port,
            remote_host: r.remote_host.clone(),
            remote_port: r.remote_port,
            enabled: r.enabled,
            bind_all: r.bind_all,
            auto_reconnect: r.auto_reconnect,
            autostart: r.autostart,
            sort_order: r.sort_order,
        })
        .collect();

    Bundle {
        format: FORMAT.to_string(),
        version: VERSION,
        exported_at,
        app_version: app_version.to_string(),
        hosts,
        tunnels,
        settings,
        snippets: snippets
            .iter()
            .map(|s| BundleSnippet {
                name: s.name.clone(),
                command: s.command.clone(),
                auto_enter: s.auto_enter,
            })
            .collect(),
    }
}

/// Parses a bundle, refusing anything that isn't one. The two rejections
/// are deliberately different sentences: picking the wrong file and
/// picking a file from a newer shellx need different fixes.
pub fn parse(text: &str) -> std::result::Result<Bundle, String> {
    let bundle: Bundle = serde_json::from_str(text)
        .map_err(|e| format!("not a shellx config bundle: {e}"))?;
    if bundle.format != FORMAT {
        return Err(format!(
            "not a shellx config bundle (found format \"{}\")",
            bundle.format
        ));
    }
    if bundle.version > VERSION {
        return Err(format!(
            "this bundle was written by a newer shellx (format version {}, this build reads {VERSION})",
            bundle.version
        ));
    }
    Ok(bundle)
}

/// One host as the preview offers it: what it is, how many rules come
/// with it, and whether this machine already has it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportRow {
    #[serde(flatten)]
    pub host: BundleHost,
    pub tunnel_count: usize,
    /// Same address already saved here. Not an error — just a reason to
    /// leave the row unchecked by default.
    pub duplicate: bool,
}

/// An address, not a label, decides sameness: two hosts reached the same
/// way are the same machine however they happen to be named.
fn same_machine(a: &BundleHost, b: &HostRecord) -> bool {
    a.host.eq_ignore_ascii_case(&b.host)
        && a.port == b.port
        && a.username.eq_ignore_ascii_case(&b.username)
}

pub fn plan(bundle: &Bundle, existing: &[HostRecord]) -> Vec<ImportRow> {
    bundle
        .hosts
        .iter()
        .map(|h| ImportRow {
            tunnel_count: bundle.tunnels.iter().filter(|r| r.host_id == h.id).count(),
            duplicate: existing.iter().any(|e| same_machine(h, e)),
            host: h.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;

    fn host(id: u128, label: &str) -> HostRecord {
        HostRecord {
            id: Uuid::from_u128(id),
            label: label.into(),
            host: format!("{label}.example.com"),
            port: 22,
            username: "deploy".into(),
            notes: None,
            created_at: 1,
            last_connected_at: Some(9),
            sort_order: 1,
            auth_method: "password".into(),
            key_path: None,
            connection_mode: "terminal_only".into(),
        }
    }

    fn rule(host_id: u128, local_port: u16) -> TunnelRule {
        TunnelRule {
            id: Uuid::from_u128(900 + local_port as u128),
            host_id: Uuid::from_u128(host_id),
            label: "db".into(),
            local_port,
            remote_host: "127.0.0.1".into(),
            remote_port: 5432,
            enabled: true,
            bind_all: false,
            auto_reconnect: true,
            autostart: false,
            sort_order: 0,
            created_at: 5,
        }
    }

    fn no_secrets(_: Uuid) -> SecretFlags {
        SecretFlags::default()
    }

    fn settings(language: &str) -> Settings {
        Settings {
            theme_id: "warm-minimal".into(),
            density: "comfortable".into(),
            system_font: "system-default".into(),
            system_font_size: 13,
            files_font_size: 13,
            terminal: crate::settings::TerminalSettings {
                font_family: "JetBrains Mono".into(),
                font_size: 13,
                cursor_style: "bar".into(),
            },
            local_shell: None,
            language: language.into(),
            auto_update_check: true,
            advanced: Default::default(),
            schema_version: 1,
        }
    }

    #[test]
    fn carries_hosts_and_their_rules() {
        let b = build(&[host(1, "web")], &[rule(1, 5432)], None, &[], no_secrets, "0.22.0", 42);
        assert_eq!(b.format, FORMAT);
        assert_eq!(b.version, VERSION);
        assert_eq!(b.app_version, "0.22.0");
        assert_eq!(b.exported_at, 42);
        assert_eq!(b.hosts.len(), 1);
        assert_eq!(b.tunnels.len(), 1);
        assert_eq!(b.tunnels[0].host_id, b.hosts[0].id);
        assert!(b.settings.is_none());
    }

    #[test]
    fn no_secret_ever_reaches_the_file() {
        // The flags say a password existed; the text must still contain
        // no password. This is the whole point of the module.
        let flags = |_: Uuid| SecretFlags { has_password: true, has_passphrase: true };
        let b = build(&[host(1, "web")], &[], None, &[], flags, "0.22.0", 0);
        assert!(b.hosts[0].has_password);
        let text = serde_json::to_string(&b).unwrap();
        assert!(!text.contains("password\":\"") , "no password value may be serialized");
        assert!(!text.to_lowercase().contains("passphrase\":\""));
    }

    #[test]
    fn drops_a_rule_whose_host_is_not_in_the_bundle() {
        // Deleting a host leaves its rules behind in the database, so a
        // rule pointing at nothing is a real state, not a hypothetical.
        let b = build(&[host(1, "web")], &[rule(1, 5432), rule(2, 6000)], None, &[], no_secrets, "0", 0);
        assert_eq!(b.tunnels.len(), 1);
        assert_eq!(b.tunnels[0].local_port, 5432);
    }

    #[test]
    fn a_round_trip_survives_json() {
        let b = build(&[host(1, "web")], &[rule(1, 5432)], Some(settings("zh")), &[], no_secrets, "0.22.0", 7);
        let text = serde_json::to_string_pretty(&b).unwrap();
        let back = parse(&text).unwrap();
        assert_eq!(back.hosts, b.hosts);
        assert_eq!(back.tunnels, b.tunnels);
        assert_eq!(back.settings.unwrap().language, "zh");
    }

    #[test]
    fn refuses_a_file_that_is_not_a_bundle() {
        assert!(parse("{\"hello\":1}").is_err());
        assert!(parse("not json at all").is_err());
        let wrong = r#"{"format":"something.else","version":1,"exportedAt":0,
            "appVersion":"0","hosts":[],"tunnels":[]}"#;
        let err = parse(wrong).unwrap_err();
        assert!(err.contains("something.else"), "the error names what it found: {err}");
    }

    #[test]
    fn refuses_a_bundle_from_a_newer_shellx() {
        let newer = r#"{"format":"shellx.config","version":99,"exportedAt":0,
            "appVersion":"9.9.9","hosts":[],"tunnels":[]}"#;
        let err = parse(newer).unwrap_err();
        assert!(err.contains("newer shellx"), "{err}");
    }

    #[test]
    fn a_bundle_without_settings_still_loads() {
        let b = build(&[host(1, "web")], &[], None, &[], no_secrets, "0", 0);
        let text = serde_json::to_string(&b).unwrap();
        assert!(!text.contains("settings"), "an absent block is omitted, not null");
        assert!(parse(&text).unwrap().settings.is_none());
    }

    #[test]
    fn the_plan_counts_rules_and_flags_what_is_already_here() {
        let b = build(
            &[host(1, "web"), host(2, "db")],
            &[rule(1, 5432), rule(1, 6379), rule(2, 8080)],
            None, &[], no_secrets, "0", 0,
        );
        // The same machine under a different label is still the same.
        let mut existing = host(77, "web");
        existing.label = "renamed in the meantime".into();
        let rows = plan(&b, &[existing]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].tunnel_count, 2);
        assert!(rows[0].duplicate);
        assert_eq!(rows[1].tunnel_count, 1);
        assert!(!rows[1].duplicate, "db is not saved here yet");
    }

    #[test]
    fn a_different_port_or_user_is_a_different_machine() {
        let b = build(&[host(1, "web")], &[], None, &[], no_secrets, "0", 0);
        let mut other_port = host(2, "web");
        other_port.port = 2222;
        assert!(!plan(&b, &[other_port])[0].duplicate);
        let mut other_user = host(3, "web");
        other_user.username = "root".into();
        assert!(!plan(&b, &[other_user])[0].duplicate);
    }
}

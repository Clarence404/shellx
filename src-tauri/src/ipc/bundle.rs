use crate::bundle::{self, Bundle, ImportRow, SecretFlags};
use crate::error::{Error, Result};
use crate::settings::SettingsStore;
use crate::store::hosts::NewHost;
use crate::store::tunnels::NewTunnelRule;
use crate::store::snippets::SnippetStore;
use crate::store::{HostStore, KeychainStore, TunnelStore};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub path: String,
    pub hosts: usize,
    pub tunnels: usize,
    pub settings_included: bool,
    pub snippets: usize,
    /// How many exported hosts will need their password typed again on
    /// the other machine. Said out loud at export time, because that is
    /// when someone can still write it down.
    pub secrets_left_behind: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    pub path: String,
    pub include_settings: bool,
}

/// Writes every saved host, every tunnel rule and (optionally) settings
/// to one JSON file. Written to a temporary sibling and renamed, so a
/// failure part-way through cannot leave a half-file where a good export
/// used to be.
#[tauri::command]
pub async fn config_bundle_export(
    args: ExportArgs,
    hosts: State<'_, HostStore>,
    tunnels: State<'_, TunnelStore>,
    settings: State<'_, SettingsStore>,
    snippets: State<'_, SnippetStore>,
    keychain: State<'_, KeychainStore>,
) -> Result<ExportSummary> {
    // Probe presence only. `get_password` returns the plaintext, so the
    // value is dropped right here and never travels any further.
    let kc = &*keychain;
    export_to(&args, &hosts, &tunnels, &settings, &snippets, |id| SecretFlags {
        has_password: kc.get_password(id).ok().flatten().is_some(),
        has_passphrase: kc.get_passphrase(id).ok().flatten().is_some(),
    })
    .await
}

pub async fn export_to(
    args: &ExportArgs,
    hosts: &HostStore,
    tunnels: &TunnelStore,
    settings: &SettingsStore,
    snippets: &SnippetStore,
    secrets: impl Fn(Uuid) -> SecretFlags,
) -> Result<ExportSummary> {
    let host_records = hosts.list().await?;
    let tunnel_rules = tunnels.list_all().await?;
    let snippet_rows = snippets.list().await?;
    let settings_block = if args.include_settings {
        settings.load()?
    } else {
        None
    };

    let bundle = bundle::build(
        &host_records,
        &tunnel_rules,
        settings_block,
        &snippet_rows,
        secrets,
        env!("CARGO_PKG_VERSION"),
        now_ms(),
    );

    let text = serde_json::to_string_pretty(&bundle)
        .map_err(|e| Error::Protocol(format!("serialize bundle: {e}")))?;
    write_atomically(Path::new(&args.path), &text)?;

    let summary = ExportSummary {
        path: args.path.clone(),
        hosts: bundle.hosts.len(),
        tunnels: bundle.tunnels.len(),
        settings_included: bundle.settings.is_some(),
        snippets: bundle.snippets.len(),
        secrets_left_behind: bundle
            .hosts
            .iter()
            .filter(|h| h.has_password || h.has_passphrase)
            .count(),
    };
    crate::log_info!(
        crate::logs::categories::HOST,
        "exported config bundle",
        "hosts": summary.hosts,
        "tunnels": summary.tunnels,
        "settings": summary.settings_included,
    );
    Ok(summary)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BundlePreview {
    pub path: String,
    pub app_version: String,
    pub exported_at: i64,
    pub rows: Vec<ImportRow>,
    pub tunnels: usize,
    pub has_settings: bool,
    pub snippets: usize,
}

#[derive(Deserialize)]
pub struct PathArgs {
    pub path: String,
}

/// Reads a bundle and says what importing it would do. Writes nothing.
#[tauri::command]
pub async fn config_bundle_preview(
    args: PathArgs,
    hosts: State<'_, HostStore>,
) -> Result<BundlePreview> {
    preview_of(args, &hosts).await
}

pub async fn preview_of(args: PathArgs, hosts: &HostStore) -> Result<BundlePreview> {
    let parsed = read_bundle(&args.path)?;
    let existing = hosts.list().await?;
    Ok(BundlePreview {
        path: args.path,
        app_version: parsed.app_version.clone(),
        exported_at: parsed.exported_at,
        rows: bundle::plan(&parsed, &existing),
        tunnels: parsed.tunnels.len(),
        has_settings: parsed.settings.is_some(),
        snippets: parsed.snippets.len(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportArgs {
    pub path: String,
    /// Ids as they appear *inside the bundle*. Anything not listed here
    /// is left alone, along with its tunnel rules.
    pub host_ids: Vec<Uuid>,
    pub include_settings: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub hosts_added: usize,
    pub tunnels_added: usize,
    pub settings_applied: bool,
    pub snippets_added: usize,
    /// Hosts that were selected but could not be written, with the
    /// reason. An import that half-worked has to say which half.
    pub failures: Vec<String>,
}

/// Adds the selected hosts as new rows — never overwriting an existing
/// host, since "the same machine" is a guess and losing a working entry
/// to a bad guess is worse than a duplicate you can delete.
#[tauri::command]
pub async fn config_bundle_import(
    args: ImportArgs,
    hosts: State<'_, HostStore>,
    tunnels: State<'_, TunnelStore>,
    settings: State<'_, SettingsStore>,
    snippets: State<'_, SnippetStore>,
) -> Result<ImportSummary> {
    import_from(args, &hosts, &tunnels, &settings, &snippets).await
}

pub async fn import_from(
    args: ImportArgs,
    hosts: &HostStore,
    tunnels: &TunnelStore,
    settings: &SettingsStore,
    snippets: &SnippetStore,
) -> Result<ImportSummary> {
    let parsed = read_bundle(&args.path)?;
    let mut summary = ImportSummary {
        hosts_added: 0,
        tunnels_added: 0,
        settings_applied: false,
        snippets_added: 0,
        failures: Vec::new(),
    };

    for wanted in &args.host_ids {
        let Some(h) = parsed.hosts.iter().find(|h| h.id == *wanted) else {
            summary.failures.push(format!("{wanted}: not in this bundle"));
            continue;
        };
        let inserted = hosts
            .insert(NewHost {
                label: h.label.clone(),
                host: h.host.clone(),
                port: h.port,
                username: h.username.clone(),
                notes: h.notes.clone(),
                auth_method: h.auth_method.clone(),
                key_path: h.key_path.clone(),
                connection_mode: Some(h.connection_mode.clone()),
            })
            .await;
        let record = match inserted {
            Ok(r) => r,
            Err(e) => {
                summary.failures.push(format!("{}: {e}", h.label));
                continue;
            }
        };
        summary.hosts_added += 1;

        // Rules follow their host under the id it was just given here.
        for rule in parsed.tunnels.iter().filter(|r| r.host_id == h.id) {
            match tunnels
                .insert(NewTunnelRule {
                    host_id: record.id,
                    label: rule.label.clone(),
                    local_port: rule.local_port,
                    remote_host: rule.remote_host.clone(),
                    remote_port: rule.remote_port,
                    enabled: Some(rule.enabled),
                    bind_all: Some(rule.bind_all),
                    auto_reconnect: Some(rule.auto_reconnect),
                    autostart: Some(rule.autostart),
                })
                .await
            {
                Ok(_) => summary.tunnels_added += 1,
                Err(e) => summary
                    .failures
                    .push(format!("{} · {}: {e}", h.label, rule.local_port)),
            }
        }
    }

    // Snippets ride along whole: they are global, carry no secrets, and
    // an exact duplicate (same name, same command) is simply skipped.
    for snip in &parsed.snippets {
        match snippets.exists(&snip.name, &snip.command).await {
            Ok(true) => {}
            Ok(false) => match snippets
                .insert(crate::store::snippets::NewSnippet {
                    name: snip.name.clone(),
                    command: snip.command.clone(),
                    auto_enter: snip.auto_enter,
                })
                .await
            {
                Ok(_) => summary.snippets_added += 1,
                Err(e) => summary.failures.push(format!("snippet {}: {e}", snip.name)),
            },
            Err(e) => summary.failures.push(format!("snippet {}: {e}", snip.name)),
        }
    }

    if args.include_settings {
        if let Some(mut s) = parsed.settings.clone() {
            // A hand-edited bundle must not be able to wedge the app, so
            // the advanced block goes through the same clamps the UI uses.
            s.advanced = s.advanced.sanitized();
            match settings.save(&s) {
                Ok(()) => summary.settings_applied = true,
                Err(e) => summary.failures.push(format!("settings: {e}")),
            }
        }
    }

    crate::log_info!(
        crate::logs::categories::HOST,
        "imported config bundle",
        "hosts": summary.hosts_added,
        "tunnels": summary.tunnels_added,
        "settings": summary.settings_applied,
        "failures": summary.failures.len(),
    );
    Ok(summary)
}

fn read_bundle(path: &str) -> Result<Bundle> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| Error::Protocol(format!("read {path}: {e}")))?;
    bundle::parse(&text).map_err(Error::Protocol)
}

/// Same write-then-rename dance `SettingsStore::save` uses.
fn write_atomically(path: &Path, text: &str) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| Error::Protocol(format!("write bundle: {e}")))?;
    std::fs::rename(&tmp, path).map_err(|e| Error::Protocol(format!("finish bundle: {e}")))?;
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// A machine: its own config dir, its own database.
    struct Machine {
        _dir: TempDir,
        hosts: HostStore,
        tunnels: TunnelStore,
        settings: SettingsStore,
        snippets: SnippetStore,
    }

    fn machine() -> Machine {
        let dir = TempDir::new().unwrap();
        let hosts = HostStore::open(dir.path()).unwrap();
        let tunnels = TunnelStore::new(hosts.conn_arc());
        let settings = SettingsStore::open(dir.path());
        let snippets = SnippetStore::new(hosts.conn_arc()).unwrap();
        Machine { _dir: dir, hosts, tunnels, settings, snippets }
    }

    fn new_host(label: &str) -> NewHost {
        NewHost {
            label: label.into(),
            host: format!("{label}.example.com"),
            port: 22,
            username: "deploy".into(),
            notes: None,
            auth_method: "password".into(),
            key_path: None,
            connection_mode: Some("term_tunnels".into()),
        }
    }

    fn no_secrets(_: Uuid) -> SecretFlags {
        SecretFlags::default()
    }

    async fn export(m: &Machine, path: &Path, include_settings: bool) -> ExportSummary {
        export_to(
            &ExportArgs {
                path: path.display().to_string(),
                include_settings,
            },
            &m.hosts,
            &m.tunnels,
            &m.settings,
            &m.snippets,
            no_secrets,
        )
        .await
        .unwrap()
    }

    fn rule(host_id: Uuid, port: u16) -> NewTunnelRule {
        NewTunnelRule {
            host_id,
            label: String::new(),
            local_port: port,
            remote_host: "127.0.0.1".into(),
            remote_port: port,
            enabled: None,
            bind_all: None,
            auto_reconnect: None,
            autostart: None,
        }
    }

    #[tokio::test]
    async fn snippets_travel_and_duplicates_stay_single() {
        let file = TempDir::new().unwrap();
        let path = file.path().join("bundle.json");

        let old = machine();
        old.snippets
            .insert(crate::store::snippets::NewSnippet {
                name: "查磁盘".into(),
                command: "df -h".into(),
                auto_enter: true,
            })
            .await
            .unwrap();
        let summary = export(&old, &path, false).await;
        assert_eq!(summary.snippets, 1);

        let fresh = machine();
        // Already having the identical snippet means the import adds nothing.
        fresh
            .snippets
            .insert(crate::store::snippets::NewSnippet {
                name: "查磁盘".into(),
                command: "df -h".into(),
                auto_enter: true,
            })
            .await
            .unwrap();
        let result = import_from(
            ImportArgs {
                path: path.display().to_string(),
                host_ids: vec![],
                include_settings: false,
            },
            &fresh.hosts,
            &fresh.tunnels,
            &fresh.settings,
            &fresh.snippets,
        )
        .await
        .unwrap();
        assert_eq!(result.snippets_added, 0);
        assert_eq!(fresh.snippets.list().await.unwrap().len(), 1);

        // A machine without it gets it, auto_enter included.
        let blank = machine();
        let result = import_from(
            ImportArgs {
                path: path.display().to_string(),
                host_ids: vec![],
                include_settings: false,
            },
            &blank.hosts,
            &blank.tunnels,
            &blank.settings,
            &blank.snippets,
        )
        .await
        .unwrap();
        assert_eq!(result.snippets_added, 1);
        assert!(blank.snippets.list().await.unwrap()[0].auto_enter);
    }

    #[tokio::test]
    async fn a_setup_survives_the_trip_to_another_machine() {
        let file = TempDir::new().unwrap();
        let path = file.path().join("bundle.json");

        let old = machine();
        let web = old.hosts.insert(new_host("web")).await.unwrap();
        old.hosts.insert(new_host("db")).await.unwrap();
        old.tunnels
            .insert(NewTunnelRule {
                host_id: web.id,
                label: "postgres".into(),
                local_port: 5432,
                remote_host: "127.0.0.1".into(),
                remote_port: 5432,
                enabled: Some(true),
                bind_all: Some(true),
                auto_reconnect: Some(false),
                autostart: Some(true),
            })
            .await
            .unwrap();

        let summary = export(&old, &path, false).await;
        assert_eq!(summary.hosts, 2);
        assert_eq!(summary.tunnels, 1);
        assert!(path.exists());

        // A fresh machine takes both hosts.
        let fresh = machine();
        let preview = preview_of(
            PathArgs { path: path.display().to_string() },
            &fresh.hosts,
        )
        .await
        .unwrap();
        assert_eq!(preview.rows.len(), 2);
        assert!(preview.rows.iter().all(|r| !r.duplicate), "nothing is saved there yet");

        let result = import_from(
            ImportArgs {
                path: path.display().to_string(),
                host_ids: preview.rows.iter().map(|r| r.host.id).collect(),
                include_settings: false,
            },
            &fresh.hosts,
            &fresh.tunnels,
            &fresh.settings,
            &fresh.snippets,
        )
        .await
        .unwrap();
        assert_eq!(result.hosts_added, 2);
        assert_eq!(result.tunnels_added, 1);
        assert!(result.failures.is_empty());

        let landed = fresh.hosts.list().await.unwrap();
        let web_there = landed.iter().find(|h| h.label == "web").unwrap();
        assert_eq!(web_there.host, "web.example.com");
        assert_eq!(web_there.connection_mode, "term_tunnels", "the mode travels too");
        assert_ne!(web_there.id, web.id, "the new machine mints its own ids");

        // The rule followed its host under the id it was just given.
        let rules = fresh.tunnels.list_for_host(web_there.id).await.unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].local_port, 5432);
        assert!(rules[0].bind_all);
        assert!(!rules[0].auto_reconnect);
        assert!(rules[0].autostart);
    }

    #[tokio::test]
    async fn importing_some_hosts_leaves_the_other_rules_behind() {
        let file = TempDir::new().unwrap();
        let path = file.path().join("bundle.json");

        let old = machine();
        let web = old.hosts.insert(new_host("web")).await.unwrap();
        let db = old.hosts.insert(new_host("db")).await.unwrap();
        old.tunnels.insert(rule(web.id, 5432)).await.unwrap();
        old.tunnels.insert(rule(db.id, 6379)).await.unwrap();
        export(&old, &path, false).await;

        let fresh = machine();
        let result = import_from(
            ImportArgs {
                path: path.display().to_string(),
                host_ids: vec![web.id],
                include_settings: false,
            },
            &fresh.hosts,
            &fresh.tunnels,
            &fresh.settings,
            &fresh.snippets,
        )
        .await
        .unwrap();
        assert_eq!(result.hosts_added, 1);
        assert_eq!(result.tunnels_added, 1, "only the rule belonging to web came across");
        assert_eq!(fresh.tunnels.list_all().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_second_import_is_reported_as_already_here() {
        let file = TempDir::new().unwrap();
        let path = file.path().join("bundle.json");

        let old = machine();
        old.hosts.insert(new_host("web")).await.unwrap();
        export(&old, &path, false).await;

        // Previewing against the machine it came from: every row is a
        // duplicate, which is a flag on the row, not a refusal.
        let preview = preview_of(PathArgs { path: path.display().to_string() }, &old.hosts)
            .await
            .unwrap();
        assert!(preview.rows[0].duplicate);
    }

    #[tokio::test]
    async fn settings_travel_only_when_asked_for() {
        let file = TempDir::new().unwrap();
        let path = file.path().join("bundle.json");

        let old = machine();
        let mut s = crate::settings::Settings {
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
            language: "zh".into(),
            auto_update_check: true,
            advanced: Default::default(),
            schema_version: 1,
        };
        // A hand-edited bundle must not be able to wedge the new machine.
        s.advanced.sftp_concurrency = 999;
        old.settings.save(&s).unwrap();

        // Left out unless the export asked for them.
        let without = export(&old, &path, false).await;
        assert!(!without.settings_included);
        let preview = preview_of(PathArgs { path: path.display().to_string() }, &old.hosts)
            .await
            .unwrap();
        assert!(!preview.has_settings);

        let with = export(&old, &path, true).await;
        assert!(with.settings_included);

        let fresh = machine();
        let result = import_from(
            ImportArgs {
                path: path.display().to_string(),
                host_ids: vec![],
                include_settings: true,
            },
            &fresh.hosts,
            &fresh.tunnels,
            &fresh.settings,
            &fresh.snippets,
        )
        .await
        .unwrap();
        assert!(result.settings_applied);
        let landed = fresh.settings.load().unwrap().unwrap();
        assert_eq!(landed.language, "zh");
        assert_eq!(landed.advanced.sftp_concurrency, 16, "clamped on the way in");
    }

    #[tokio::test]
    async fn a_host_id_that_is_not_in_the_bundle_is_named_not_swallowed() {
        let file = TempDir::new().unwrap();
        let path = file.path().join("bundle.json");
        let old = machine();
        old.hosts.insert(new_host("web")).await.unwrap();
        export(&old, &path, false).await;

        let fresh = machine();
        let stray = Uuid::from_u128(1234);
        let result = import_from(
            ImportArgs {
                path: path.display().to_string(),
                host_ids: vec![stray],
                include_settings: false,
            },
            &fresh.hosts,
            &fresh.tunnels,
            &fresh.settings,
            &fresh.snippets,
        )
        .await
        .unwrap();
        assert_eq!(result.hosts_added, 0);
        assert_eq!(result.failures.len(), 1);
        assert!(result.failures[0].contains(&stray.to_string()));
    }

    #[tokio::test]
    async fn reading_a_file_that_is_not_a_bundle_fails_with_a_sentence() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("holiday.json");
        std::fs::write(&path, "{\"photos\": 400}").unwrap();
        let m = machine();
        let err = preview_of(PathArgs { path: path.display().to_string() }, &m.hosts)
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("not a shellx config bundle"), "{err}");
    }
}

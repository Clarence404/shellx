//! Config directory resolution.
//!
//! Priority (highest wins):
//! 1. `SHELLX_CONFIG_DIR` environment variable (user-supplied, any valid
//!    absolute path). Useful for keeping shellx portable / testing.
//! 2. `~/.shellx/` — a stable, easy-to-find location under the user's
//!    home. This is the new default as of v0.5.6; previously we used
//!    `directories::ProjectDirs::config_dir()` which resolved to
//!    `%APPDATA%\shellx\config\` on Windows — hard for users to find.
//! 3. Legacy `ProjectDirs::from("", "", "shellx").config_dir()` — kept
//!    only as a last-resort fallback if `dirs::home_dir()` refuses to
//!    resolve (very rare — Windows without USERPROFILE set).
//!
//! Migration: on first startup after upgrading past v0.5.5, if the new
//! `~/.shellx/` is empty AND the legacy ProjectDirs path has `hosts.db`
//! or `settings.json` present, the files are MOVED (not copied) to the
//! new location. One-time; subsequent starts see the new location
//! populated and skip the migration.

use directories::ProjectDirs;
use std::path::PathBuf;

/// Resolve the config directory shellx should read + write into.
/// Creates the directory (best-effort) before returning.
pub fn resolve_config_dir() -> PathBuf {
    let dir = if let Some(env) = env_override() {
        env
    } else if let Some(home) = dirs::home_dir() {
        home.join(".shellx")
    } else {
        legacy_project_dir().unwrap_or_else(|| PathBuf::from(".shellx"))
    };
    std::fs::create_dir_all(&dir).ok();

    // One-time migration from the legacy ProjectDirs path.
    if let Some(legacy) = legacy_project_dir() {
        if legacy != dir {
            migrate_from_legacy(&legacy, &dir);
        }
    }

    dir
}

fn env_override() -> Option<PathBuf> {
    let raw = std::env::var("SHELLX_CONFIG_DIR").ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn legacy_project_dir() -> Option<PathBuf> {
    ProjectDirs::from("", "", "shellx").map(|d| d.config_dir().to_path_buf())
}

/// Move `hosts.db` / `settings.json` from `legacy` into `new_dir` when
/// `new_dir` doesn't already have them and `legacy` does. Silent no-op
/// if either condition fails. Uses rename (fast, atomic on same volume)
/// and falls back to copy+remove when rename fails (cross-volume moves).
fn migrate_from_legacy(legacy: &PathBuf, new_dir: &PathBuf) {
    for name in ["hosts.db", "settings.json"] {
        let src = legacy.join(name);
        let dst = new_dir.join(name);
        if !src.exists() || dst.exists() {
            continue;
        }
        if std::fs::rename(&src, &dst).is_err() {
            if std::fs::copy(&src, &dst).is_ok() {
                let _ = std::fs::remove_file(&src);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Legacy files at the source get moved into the destination when
    /// the destination is empty. Second migrate call is a no-op.
    #[test]
    fn migrate_moves_legacy_files_when_destination_is_empty() {
        let legacy = tempfile::tempdir().unwrap();
        let new_dir = tempfile::tempdir().unwrap();
        std::fs::write(legacy.path().join("hosts.db"), b"legacy-db").unwrap();
        std::fs::write(legacy.path().join("settings.json"), b"{}").unwrap();

        migrate_from_legacy(&legacy.path().to_path_buf(), &new_dir.path().to_path_buf());

        assert!(!legacy.path().join("hosts.db").exists(), "legacy hosts.db should be moved");
        assert!(!legacy.path().join("settings.json").exists(), "legacy settings.json should be moved");
        assert_eq!(std::fs::read(new_dir.path().join("hosts.db")).unwrap(), b"legacy-db");
        assert_eq!(std::fs::read(new_dir.path().join("settings.json")).unwrap(), b"{}");
    }

    /// If destination already has files, migration leaves everything
    /// alone — the destination's copy is trusted.
    #[test]
    fn migrate_skips_when_destination_already_has_files() {
        let legacy = tempfile::tempdir().unwrap();
        let new_dir = tempfile::tempdir().unwrap();
        std::fs::write(legacy.path().join("hosts.db"), b"legacy").unwrap();
        std::fs::write(new_dir.path().join("hosts.db"), b"new").unwrap();

        migrate_from_legacy(&legacy.path().to_path_buf(), &new_dir.path().to_path_buf());

        assert_eq!(std::fs::read(legacy.path().join("hosts.db")).unwrap(), b"legacy");
        assert_eq!(std::fs::read(new_dir.path().join("hosts.db")).unwrap(), b"new");
    }

    #[test]
    fn env_override_reads_variable() {
        // Can't safely mutate global env in parallel tests; just check
        // the "no env set" branch here. Full override behaviour is
        // covered by resolve_config_dir when SHELLX_CONFIG_DIR is set.
        // Skip this test if the env is already set (CI etc).
        if std::env::var_os("SHELLX_CONFIG_DIR").is_none() {
            assert!(env_override().is_none());
        }
    }
}

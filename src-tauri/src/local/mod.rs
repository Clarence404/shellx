//! Local (host-machine) filesystem operations.

use crate::error::{Error, Result};
use crate::protocol::sftp_types::EntryKind;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LocalEntry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    pub modified: Option<i64>,
    pub permissions: u32,
}

#[derive(Serialize)]
pub struct DefaultRoots {
    pub home: String,
    pub desktop: String,
    pub downloads: String,
}

fn expand(path: &str) -> Result<PathBuf> {
    if let Some(rest) = path.strip_prefix('~') {
        let home = dirs::home_dir()
            .ok_or_else(|| Error::Protocol("no home dir".into()))?;
        let tail = rest.trim_start_matches(['/', '\\']);
        Ok(if tail.is_empty() { home } else { home.join(tail) })
    } else {
        Ok(PathBuf::from(path))
    }
}

pub fn list_dir(path: &str) -> Result<Vec<LocalEntry>> {
    let base = expand(path)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&base)
        .map_err(|e| Error::Protocol(format!("read_dir {}: {e}", base.display())))?
    {
        let entry = entry.map_err(|e| Error::Protocol(format!("read_dir entry: {e}")))?;
        let meta = entry.metadata()
            .map_err(|e| Error::Protocol(format!("metadata: {e}")))?;
        let ft = meta.file_type();
        let kind = if ft.is_dir() { EntryKind::Directory }
                   else if ft.is_symlink() { EntryKind::Symlink }
                   else if ft.is_file() { EntryKind::File }
                   else { EntryKind::Other };
        let modified = meta.modified().ok().and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
        });
        #[cfg(unix)]
        let permissions = {
            use std::os::unix::fs::PermissionsExt;
            meta.permissions().mode()
        };
        #[cfg(not(unix))]
        let permissions = 0u32;
        out.push(LocalEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
            size: meta.len(),
            modified,
            permissions,
        });
    }
    Ok(out)
}

/// Normalizes a path to forward-slash form on Windows so the frontend's
/// path-split / `..`-rejoin / breadcrumb logic works consistently. Windows
/// std::fs accepts both `\` and `/` transparently, so this loses nothing on
/// the Rust side but avoids `C:\Users\chen`.split("/").join("/") producing
/// `/C:/Users/chen` after `..` navigation. No-op on POSIX.
#[cfg(windows)]
fn to_forward(s: String) -> String { s.replace('\\', "/") }
#[cfg(not(windows))]
fn to_forward(s: String) -> String { s }

pub fn realpath(path: &str) -> Result<String> {
    let expanded = expand(path)?;
    let canonical = expanded
        .canonicalize()
        .map_err(|e| Error::Protocol(format!("realpath {}: {e}", expanded.display())))?;
    let s = canonical.to_string_lossy().into_owned();
    // Strip Windows UNC prefix that std's canonicalize prepends. Rust std
    // returns `\\?\C:\...` from GetFinalPathNameByHandleW on Windows (four
    // chars: `\`, `\`, `?`, `\`); that form breaks path.split("/") and
    // label-equality comparisons in the UI.
    // See rust-lang/rust#42869.
    #[cfg(windows)]
    let s = s.strip_prefix(r"\\?\").map(String::from).unwrap_or(s);
    Ok(to_forward(s))
}

pub fn default_roots() -> DefaultRoots {
    fn s(p: Option<PathBuf>) -> String {
        p.map(|p| to_forward(p.to_string_lossy().into_owned())).unwrap_or_default()
    }
    DefaultRoots {
        home: s(dirs::home_dir()),
        desktop: s(dirs::desktop_dir()),
        downloads: s(dirs::download_dir()),
    }
}

pub fn mkdir(path: &str) -> Result<()> {
    let p = expand(path)?;
    std::fs::create_dir(&p)
        .map_err(|e| Error::Protocol(format!("mkdir {}: {e}", p.display())))
}

pub fn rename(from: &str, to: &str) -> Result<()> {
    let f = expand(from)?;
    let t = expand(to)?;
    std::fs::rename(&f, &t)
        .map_err(|e| Error::Protocol(format!("rename {} → {}: {e}", f.display(), t.display())))
}

pub fn remove_file(path: &str) -> Result<()> {
    let p = expand(path)?;
    std::fs::remove_file(&p)
        .map_err(|e| Error::Protocol(format!("remove_file {}: {e}", p.display())))
}

pub fn remove_dir(path: &str) -> Result<()> {
    let p = expand(path)?;
    std::fs::remove_dir_all(&p)
        .map_err(|e| Error::Protocol(format!("remove_dir {}: {e}", p.display())))
}

/// Copy a file or directory FROM `src` INTO the directory at `dst_dir`
/// (a folder), preserving the source's basename. Used by LocalPane's
/// OS drag-drop handler so files dropped from Explorer/Finder land in
/// the current pane directory. Directories copy recursively. Errors
/// bubble up to the caller (frontend surfaces them via toast).
pub fn copy_into(src: &str, dst_dir: &str) -> Result<()> {
    let src_path = expand(src)?;
    let dst_dir_path = expand(dst_dir)?;
    let name = src_path.file_name()
        .ok_or_else(|| Error::Protocol(format!("copy_into: src has no basename: {}", src_path.display())))?;
    let dst_path = dst_dir_path.join(name);
    if src_path.is_dir() {
        copy_dir_recursive(&src_path, &dst_path)
    } else {
        std::fs::copy(&src_path, &dst_path)
            .map(|_| ())
            .map_err(|e| Error::Protocol(format!("copy {} → {}: {e}", src_path.display(), dst_path.display())))
    }
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<()> {
    std::fs::create_dir_all(dst)
        .map_err(|e| Error::Protocol(format!("mkdir {}: {e}", dst.display())))?;
    for entry in std::fs::read_dir(src)
        .map_err(|e| Error::Protocol(format!("read_dir {}: {e}", src.display())))?
    {
        let entry = entry.map_err(|e| Error::Protocol(format!("read_dir entry: {e}")))?;
        let src_child = entry.path();
        let dst_child = dst.join(entry.file_name());
        let ft = entry.file_type()
            .map_err(|e| Error::Protocol(format!("file_type: {e}")))?;
        if ft.is_dir() {
            copy_dir_recursive(&src_child, &dst_child)?;
        } else {
            std::fs::copy(&src_child, &dst_child)
                .map_err(|e| Error::Protocol(format!("copy {} → {}: {e}", src_child.display(), dst_child.display())))?;
        }
    }
    Ok(())
}

pub fn open_in_os(path: &str) -> Result<()> {
    let p = expand(path)?;
    let path_str = p.to_string_lossy();
    let result = if cfg!(target_os = "windows") {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", path_str.as_ref()])
            .spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(path_str.as_ref()).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(path_str.as_ref()).spawn()
    };
    result
        .map(|_| ())
        .map_err(|e| Error::Protocol(format!("open_in_os {}: {e}", p.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn list_dir_returns_entries_with_kind_and_size() {
        let td = TempDir::new().unwrap();
        fs::write(td.path().join("a.txt"), b"hello").unwrap();
        fs::create_dir(td.path().join("sub")).unwrap();

        let entries = list_dir(td.path().to_str().unwrap()).unwrap();
        assert_eq!(entries.len(), 2);
        let file = entries.iter().find(|e| e.name == "a.txt").unwrap();
        let dir = entries.iter().find(|e| e.name == "sub").unwrap();
        assert_eq!(file.kind, EntryKind::File);
        assert_eq!(file.size, 5);
        assert_eq!(dir.kind, EntryKind::Directory);
    }

    #[test]
    fn realpath_expands_tilde() {
        let expanded = realpath("~").unwrap();
        let home = dirs::home_dir().unwrap();
        // On Windows, realpath strips the `\\?\` UNC prefix that std's
        // canonicalize prepends AND normalizes `\` → `/`; do the same on
        // the RHS so both sides speak the same form. Non-Windows platforms
        // are unaffected.
        let canonical = home.canonicalize().unwrap();
        let canonical_str = canonical.to_string_lossy().into_owned();
        #[cfg(windows)]
        let canonical_str = {
            let s = canonical_str.strip_prefix(r"\\?\").map(String::from).unwrap_or(canonical_str);
            s.replace('\\', "/")
        };
        assert_eq!(expanded, canonical_str);
    }

    #[test]
    fn default_roots_returns_non_empty_home() {
        let r = default_roots();
        assert!(!r.home.is_empty(), "home dir should be resolvable in test env");
    }

    #[test]
    fn mkdir_then_remove_dir_roundtrip() {
        let td = TempDir::new().unwrap();
        let p = td.path().join("newdir");
        mkdir(p.to_str().unwrap()).unwrap();
        assert!(p.exists());
        remove_dir(p.to_str().unwrap()).unwrap();
        assert!(!p.exists());
    }

    #[test]
    fn rename_moves_file() {
        let td = TempDir::new().unwrap();
        let a = td.path().join("a.txt");
        let b = td.path().join("b.txt");
        fs::write(&a, b"x").unwrap();
        rename(a.to_str().unwrap(), b.to_str().unwrap()).unwrap();
        assert!(!a.exists());
        assert!(b.exists());
    }

    #[test]
    fn remove_file_deletes() {
        let td = TempDir::new().unwrap();
        let p = td.path().join("kill.txt");
        fs::write(&p, b"gone").unwrap();
        remove_file(p.to_str().unwrap()).unwrap();
        assert!(!p.exists());
    }

    #[test]
    #[cfg(windows)]
    fn realpath_strips_unc_prefix_on_windows() {
        // dirs::home_dir() returns non-UNC form on Windows; realpath should too
        let home = dirs::home_dir().unwrap();
        let home_str = home.to_string_lossy().into_owned();
        let resolved = realpath(&home_str).unwrap();
        assert!(!resolved.starts_with(r"\\?\"), "expected non-UNC, got {resolved}");
        assert!(resolved.contains(":/"), "expected forward-slash drive letter (C:/...), got {resolved}");
    }

    #[test]
    #[cfg(windows)]
    fn realpath_normalizes_backslashes_to_forward_slashes_on_windows() {
        // std::fs accepts both `\` and `/`; we normalize to `/` so the
        // frontend can split-and-rejoin without producing invalid mixed
        // forms like `/C:/Users` (see mod docstring for to_forward).
        let home = dirs::home_dir().unwrap();
        let resolved = realpath(&home.to_string_lossy()).unwrap();
        assert!(!resolved.contains('\\'), "expected no backslashes, got {resolved}");
    }
}

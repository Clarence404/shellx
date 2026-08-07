//! Tauri IPC surface for local (host-machine) filesystem operations.
//! Mirrors the shape of `ipc::sftp` so the frontend can layer both under
//! a unified pane component.

use crate::error::Result;
use crate::local::{self, DefaultRoots, LocalEntry};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct LocalPathArgs {
    pub path: String,
}

#[derive(Deserialize)]
pub struct LocalRenameArgs {
    pub from: String,
    pub to: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCopyIntoArgs {
    /// Absolute source path (file or directory).
    pub src: String,
    /// Absolute path to the directory that will receive `src` as a
    /// child. The source's basename is preserved inside `dst_dir`.
    pub dst_dir: String,
}

#[tauri::command]
pub async fn local_list_dir(args: LocalPathArgs) -> Result<Vec<LocalEntry>> {
    local::list_dir(&args.path)
}

#[tauri::command]
pub async fn local_realpath(args: LocalPathArgs) -> Result<String> {
    local::realpath(&args.path)
}

#[tauri::command]
pub async fn local_is_dir(args: LocalPathArgs) -> Result<bool> {
    local::is_dir(&args.path)
}

#[tauri::command]
pub async fn local_default_roots() -> Result<DefaultRoots> {
    Ok(local::default_roots())
}

#[tauri::command]
pub async fn local_mkdir(args: LocalPathArgs) -> Result<()> {
    local::mkdir(&args.path)
}

#[tauri::command]
pub async fn local_rename(args: LocalRenameArgs) -> Result<()> {
    local::rename(&args.from, &args.to)
}

#[tauri::command]
pub async fn local_remove_file(args: LocalPathArgs) -> Result<()> {
    local::remove_file(&args.path)
}

#[tauri::command]
pub async fn local_remove_dir(args: LocalPathArgs) -> Result<()> {
    local::remove_dir(&args.path)
}

#[tauri::command]
pub async fn local_open_in_os(args: LocalPathArgs) -> Result<()> {
    local::open_in_os(&args.path)
}

#[tauri::command]
pub async fn local_copy_into(args: LocalCopyIntoArgs) -> Result<()> {
    local::copy_into(&args.src, &args.dst_dir)
}

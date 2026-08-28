//! Dragging files out of the window and into the OS.
//!
//! The webview cannot start an OS drag on its own — WebView2's HTML5
//! drag events stop at the window edge. This wraps the `drag` crate,
//! which speaks the real protocol (OLE `DoDragDrop` on Windows), so a
//! row dragged past the edge becomes a drop Explorer understands.
//!
//! Only real local paths can be dragged: the OS protocol hands the
//! target a path list, nothing else. A remote file is therefore
//! downloaded to a staging folder first, and what leaves the window is
//! that copy — the same trade WinSCP makes.

use crate::error::{Error, Result};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::Window;

/// The drag preview shown under the cursor. The app icon, because the
/// thing being dragged is "a file coming out of shellx".
const DRAG_ICON: &[u8] = include_bytes!("../../icons/32x32.png");

#[derive(Deserialize)]
pub struct DragOutArgs {
    /// Absolute local paths. Anything remote has been staged by now.
    pub paths: Vec<String>,
}

#[tauri::command]
pub async fn drag_out(args: DragOutArgs, window: Window) -> Result<()> {
    if args.paths.is_empty() {
        return Err(Error::Protocol("nothing to drag".into()));
    }
    let files: Vec<PathBuf> = args.paths.iter().map(PathBuf::from).collect();
    for f in &files {
        if !f.exists() {
            return Err(Error::Protocol(format!(
                "cannot drag {}: it does not exist",
                f.display()
            )));
        }
    }
    crate::log_info!(
        crate::logs::categories::TRANSFER,
        "starting OS drag-out",
        "files": files.len(),
    );
    // OLE insists the drag starts on the thread that owns the window,
    // and DoDragDrop blocks that thread until the drop lands — which is
    // how every native drag works; the OS pumps messages meanwhile.
    let handle = window.clone();
    window
        .run_on_main_thread(move || {
            let result = drag::start_drag(
                &handle,
                drag::DragItem::Files(files),
                drag::Image::Raw(DRAG_ICON.to_vec()),
                |_result, _position| {},
                drag::Options::default(),
            );
            if let Err(e) = result {
                crate::log_warn!(
                    crate::logs::categories::TRANSFER,
                    "OS drag-out failed to start",
                    "error": e.to_string(),
                );
            }
        })
        .map_err(|e| Error::Protocol(format!("drag: {e}")))?;
    Ok(())
}

/// A fresh staging folder for one remote drag-out. Under the OS temp
/// dir, one unique folder per gesture so two drags of files with the
/// same name cannot collide.
#[tauri::command]
pub fn drag_out_staging_dir() -> Result<String> {
    let dir = std::env::temp_dir()
        .join("shellx-drag")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&dir).map_err(Error::Io)?;
    Ok(dir.to_string_lossy().into_owned())
}

//! IPC commands for opening and closing local PTY terminal sessions.

use crate::error::Result;
use crate::session::manager::SessionManager;
use crate::session::{ConnectionInfo, SessionId};
use crate::settings::SettingsStore;
use events::{ClosedEvent, DataEvent, EV_CLOSED, EV_DATA};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use super::events;

/// Default shell per platform when `settings.local_shell` is None or empty.
fn default_shell() -> String {
    #[cfg(windows)]
    {
        let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        format!("{}\\System32\\cmd.exe", sysroot)
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
}

/// Resolve a short shell name to its full path where possible, so that
/// `CommandBuilder::new` doesn't depend on the child process's PATH.
///
/// On Windows, `%SystemRoot%\System32` is guaranteed to be in PATH but
/// `WindowsPowerShell\v1.0` is not, and PowerShell 7 / Unix shells aren't
/// there at all.  Using absolute paths makes spawning reliable regardless of
/// the caller's environment.
fn resolve_shell(shell: &str) -> String {
    #[cfg(windows)]
    {
        // Already absolute — contains a backslash or a drive letter.
        if shell.contains('\\') || (shell.len() > 2 && shell.chars().nth(1) == Some(':')) {
            return shell.to_string();
        }
        let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        match shell.to_ascii_lowercase().as_str() {
            "cmd.exe" | "cmd" => format!("{}\\System32\\cmd.exe", sysroot),
            "powershell.exe" | "powershell" => {
                format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", sysroot)
            }
            "wsl.exe" | "wsl" => format!("{}\\System32\\wsl.exe", sysroot),
            "pwsh.exe" | "pwsh" => {
                // PowerShell 7 is typically in Program Files, not System32.
                let pf = std::env::var("ProgramFiles")
                    .unwrap_or_else(|_| "C:\\Program Files".into());
                let candidate = format!("{}\\PowerShell\\7\\pwsh.exe", pf);
                if std::path::Path::new(&candidate).exists() {
                    candidate
                } else {
                    shell.to_string()
                }
            }
            _ => shell.to_string(),
        }
    }
    #[cfg(not(windows))]
    {
        shell.to_string()
    }
}

#[tauri::command]
pub async fn open_local_terminal(
    app: AppHandle,
    mgr: State<'_, SessionManager>,
    settings: State<'_, SettingsStore>,
) -> Result<ConnectionInfo> {
    let shell = resolve_shell(
        &settings
            .load()
            .ok()
            .flatten()
            .and_then(|s| s.local_shell.filter(|s| !s.is_empty()))
            .unwrap_or_else(default_shell),
    );

    let info = mgr
        .open_local_session(&shell, "Local Terminal".into(), app.clone())
        .await?;

    let id = info.id;
    let mut rx = mgr.subscribe(id).await?;
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = app_clone.emit(EV_DATA, DataEvent { id, data: chunk });
        }
        let _ = app_clone.emit(EV_CLOSED, ClosedEvent { id, reason: "eof".into() });
    });

    Ok(info)
}

#[derive(Deserialize)]
pub struct CloseLocalArgs {
    pub id: SessionId,
}

#[tauri::command]
pub async fn close_local_terminal(
    args: CloseLocalArgs,
    mgr: State<'_, SessionManager>,
) -> Result<()> {
    mgr.close(args.id).await
}

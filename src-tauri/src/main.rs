// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use shellx::ipc;
use shellx::session::manager::SessionManager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .manage(SessionManager::new())
        .invoke_handler(tauri::generate_handler![
            ipc::open_ssh_session,
            ipc::write_session_input,
            ipc::resize_session,
            ipc::close_session,
            ipc::list_sessions,
        ])
        .run(tauri::generate_context!())
        .expect("shellx failed to start");
}

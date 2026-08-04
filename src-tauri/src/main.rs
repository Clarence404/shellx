// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use directories::ProjectDirs;
use shellx::ipc;
use shellx::session::manager::SessionManager;
use shellx::store::{HostStore, KeychainStore};

fn main() {
    let dirs = ProjectDirs::from("", "", "shellx").expect("cannot resolve project directory");
    let config_dir = dirs.config_dir();

    let host_store = HostStore::open(config_dir).expect("failed to open hosts.db");
    let keychain = KeychainStore::open();

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
        .manage(host_store)
        .manage(keychain)
        .invoke_handler(tauri::generate_handler![
            ipc::open_connection,
            ipc::open_shell,
            ipc::write_session_input,
            ipc::resize_session,
            ipc::close_connection,
            ipc::list_sessions,
            ipc::hosts::list_hosts,
            ipc::hosts::save_host,
            ipc::hosts::update_host,
            ipc::hosts::delete_host,
            ipc::hosts::get_host_password,
            ipc::hosts::keychain_available,
        ])
        .run(tauri::generate_context!())
        .expect("shellx failed to start");
}

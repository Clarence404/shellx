// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use shellx::config_paths::resolve_config_dir;
use shellx::ipc;
use shellx::session::manager::SessionManager;
use shellx::settings::SettingsStore;
use shellx::store::{HostStore, KeychainStore};
use shellx::transfer::TransferManager;

fn main() {
    // Resolve config dir with priority: $SHELLX_CONFIG_DIR → ~/.shellx/ →
    // legacy ProjectDirs. Also migrates hosts.db / settings.json from the
    // legacy `%APPDATA%\shellx\config\` on first run.
    let config_dir = resolve_config_dir();

    let host_store = HostStore::open(&config_dir).expect("failed to open hosts.db");
    let keychain = KeychainStore::open();
    let settings_store = SettingsStore::open(&config_dir);

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
        .plugin(tauri_plugin_dialog::init())
        .manage(SessionManager::new())
        .manage(TransferManager::new())
        .manage(host_store)
        .manage(keychain)
        .manage(settings_store)
        .manage(shellx::ipc::config::ConfigDir(config_dir.clone()))
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
            ipc::sftp::sftp_list_dir,
            ipc::sftp::sftp_stat,
            ipc::sftp::sftp_rename,
            ipc::sftp::sftp_remove_file,
            ipc::sftp::sftp_remove_dir,
            ipc::sftp::sftp_remove_dir_recursive,
            ipc::sftp::sftp_mkdir,
            ipc::sftp::sftp_realpath,
            ipc::transfer::sftp_upload,
            ipc::transfer::sftp_download,
            ipc::transfer::sftp_upload_dir,
            ipc::transfer::sftp_download_dir,
            ipc::transfer::transfer_list,
            ipc::transfer::transfer_cancel,
            ipc::transfer::transfer_cancel_group,
            ipc::transfer::transfer_pause,
            ipc::transfer::transfer_resume,
            ipc::local::local_list_dir,
            ipc::local::local_realpath,
            ipc::local::local_default_roots,
            ipc::local::local_mkdir,
            ipc::local::local_rename,
            ipc::local::local_remove_file,
            ipc::local::local_remove_dir,
            ipc::local::local_open_in_os,
            ipc::local::local_copy_into,
            ipc::settings::load_settings,
            ipc::settings::save_settings,
            ipc::config::get_config_paths,
        ])
        .run(tauri::generate_context!())
        .expect("shellx failed to start");
}

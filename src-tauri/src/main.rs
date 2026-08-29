// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use shellx::config_paths::resolve_config_dir;
use shellx::ipc;
use shellx::monitor::manager::MonitorManager;
use shellx::session::manager::SessionManager;
use shellx::settings::SettingsStore;
use shellx::ftp::manager::FtpManager;
use shellx::store::{FtpHostStore, HostStore, KeychainStore, TunnelStore};
use shellx::transfer::TransferManager;

fn main() {
    // Resolve config dir with priority: $SHELLX_CONFIG_DIR → ~/.shellx/ →
    // legacy ProjectDirs. Also migrates hosts.db / settings.json from the
    // legacy `%APPDATA%\shellx\config\` on first run.
    let config_dir = resolve_config_dir();

    let host_store = HostStore::open(&config_dir).expect("failed to open hosts.db");
    let tunnel_store = TunnelStore::new(host_store.conn_arc());
    let ftp_host_store = FtpHostStore::new(host_store.conn_arc())
        .expect("failed to prepare ftp_hosts");
    let keychain = KeychainStore::open();
    let settings_store = SettingsStore::open(&config_dir);
    // Advanced knobs are read once here: the log floor and the transfer
    // concurrency both have to be in place before anything can emit or
    // queue. Per-connection values (timeout, keepalive) are re-read at
    // each connect instead, so changing them doesn't need a restart.
    let advanced = shellx::settings::advanced_or_default(&settings_store);
    let log_floor = shellx::logs::Level::from_str(&advanced.log_level)
        .unwrap_or(shellx::logs::Level::Info);
    let plugin_log_level = match log_floor {
        shellx::logs::Level::Debug => log::LevelFilter::Debug,
        shellx::logs::Level::Info => log::LevelFilter::Info,
        shellx::logs::Level::Warn => log::LevelFilter::Warn,
        shellx::logs::Level::Error => log::LevelFilter::Error,
    };
    let transfer_mgr = TransferManager::new();
    transfer_mgr.set_concurrency(advanced.sftp_concurrency);
    // Logs subsystem lives here (ring buffer + file writer). Requires a
    // Tokio runtime for the file-writer background task, so we defer
    // actual init to the tauri setup hook below.
    let logs_config_dir = config_dir.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(plugin_log_level)
                        .build(),
                )?;
            }
            // Structured logs subsystem — ring buffer + jsonl file writer.
            // Managed here (not up in the pre-Builder block) because the
            // background writer task needs the Tauri Tokio runtime.
            let logs_store = shellx::logs::init(logs_config_dir.clone());
            // Entries below the configured level are dropped at push time,
            // so the floor governs the ring, the live stream and the jsonl
            // file alike — not just what the panel chooses to display.
            logs_store.set_min_level(log_floor);
            use tauri::Manager;
            app.handle().manage(logs_store);
            // First app-category line of every run: what started, where its
            // config lives, and on what. Makes a jsonl file self-describing.
            shellx::log_info!(
                shellx::logs::categories::APP, "shellx started",
                "version": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "config_dir": logs_config_dir.display().to_string(),
                "debug_build": cfg!(debug_assertions),
                "log_level": advanced.log_level,
            );
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(SessionManager::new())
        .manage(transfer_mgr)
        .manage(host_store)
        .manage(tunnel_store)
        .manage(ftp_host_store)
        .manage(FtpManager::new())
        .manage(keychain)
        .manage(settings_store)
        .manage(MonitorManager::new())
        .manage(shellx::ipc::config::ConfigDir(config_dir.clone()))
        .manage(shellx::ipc::hostkeys::ChallengeRegistry::default())
        .invoke_handler(tauri::generate_handler![
            ipc::open_connection,
            ipc::open_shell,
            ipc::write_session_input,
            ipc::resize_session,
            ipc::close_connection,
            ipc::list_sessions,
            ipc::local_pty::list_available_shells,
            ipc::local_pty::open_local_terminal,
            ipc::local_pty::close_local_terminal,
            ipc::hosts::list_hosts,
            ipc::hosts::save_host,
            ipc::hosts::update_host,
            ipc::hosts::delete_host,
            ipc::hosts::get_host_password,
            ipc::hosts::get_host_passphrase,
            ipc::hosts::set_host_passphrase,
            ipc::hosts::keychain_available,
            ipc::keys::keys_discover,
            ipc::sshconfig::ssh_config_scan,
            ipc::ftp::ftp_host_list,
            ipc::ftp::ftp_host_save,
            ipc::ftp::ftp_host_update,
            ipc::ftp::ftp_host_delete,
            ipc::ftp::ftp_host_import,
            ipc::ftp::ftp_connect,
            ipc::ftp::ftp_disconnect,
            ipc::ftp::ftp_active_ids,
            ipc::ftp::ftp_list_dir,
            ipc::ftp::ftp_pwd,
            ipc::ftp::ftp_mkdir,
            ipc::ftp::ftp_rename,
            ipc::ftp::ftp_remove,
            ipc::ftp::ftp_upload,
            ipc::ftp::ftp_download,
            ipc::ftp::ftp_upload_dir,
            ipc::ftp::ftp_download_dir,
            ipc::ftp::transfer_retry,
            ipc::ftp::transfer_retry_group,
            ipc::bundle::config_bundle_export,
            ipc::bundle::config_bundle_preview,
            ipc::bundle::config_bundle_import,
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
            ipc::transfer::transfer_remove,
            ipc::transfer::transfer_pause_all,
            ipc::transfer::transfer_resume_all,
            ipc::transfer::transfer_cancel_all,
            ipc::transfer::transfer_cancel_group,
            ipc::transfer::transfer_remove_group,
            ipc::transfer::transfer_pause,
            ipc::transfer::transfer_resume,
            ipc::local::local_list_dir,
            ipc::local::local_realpath,
            ipc::local::local_is_dir,
            ipc::local::local_default_roots,
            ipc::local::local_list_disks,
            ipc::local::local_mkdir,
            ipc::local::local_rename,
            ipc::local::local_remove_file,
            ipc::local::local_remove_dir,
            ipc::local::local_open_in_os,
            ipc::local::local_copy_into,
            ipc::settings::load_settings,
            ipc::settings::save_settings,
            ipc::config::get_config_paths,
            ipc::dragout::drag_out,
            ipc::dragout::drag_out_staging_dir,
            ipc::hostkeys::hostkey_respond,
            ipc::hostkeys::hostkeys_list,
            ipc::tunnels::tunnel_list_for_host,
            ipc::tunnels::tunnel_add,
            ipc::tunnels::tunnel_update,
            ipc::tunnels::tunnel_delete,
            ipc::tunnels::tunnel_open,
            ipc::tunnels::tunnel_open_via_host,
            ipc::tunnels::tunnel_list_active,
            ipc::tunnels::tunnel_close,
            ipc::tunnels::tunnel_add_session,
            ipc::tunnels::tunnel_reorder,
            ipc::monitor::monitor_start,
            ipc::monitor::monitor_stop,
            ipc::logs::logs_snapshot,
            ipc::logs::logs_subscribe,
            ipc::logs::logs_unsubscribe,
            ipc::logs::logs_export,
            ipc::logs::logs_set_disk_enabled,
            ipc::logs::logs_disk_enabled,
            ipc::logs::logs_push,
        ])
        .run(tauri::generate_context!())
        .expect("shellx failed to start");
}

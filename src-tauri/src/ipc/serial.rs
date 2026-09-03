//! IPC commands for the Serial view: port discovery, saved profiles, and
//! opening serial sessions. Closing goes through the generic
//! `close_connection` — `SessionManager::close` knows the serial map.

use crate::error::Result;
use crate::protocol::serial::SerialSpec;
use crate::session::manager::SessionManager;
use crate::session::ConnectionInfo;
use crate::store::{NewSerialProfile, SerialProfile, SerialProfileStore, SerialProfileUpdate};
use events::{ClosedEvent, DataEvent, EV_CLOSED, EV_DATA};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use super::events;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    /// OS name the open call takes: "COM3", "/dev/ttyUSB0".
    pub name: String,
    /// "usb" | "bluetooth" | "pci" | "unknown" — lets the UI sort real
    /// adapters above legacy motherboard ports.
    pub kind: String,
    /// Human hint for USB adapters ("CH340", "FT232R USB UART"), empty
    /// otherwise.
    pub product: String,
}

/// Windows keeps every live serial port — whatever device class its
/// driver registered — under HKLM\HARDWARE\DEVICEMAP\SERIALCOMM. This
/// catches virtual ports (com0com pairs, some vendor drivers) that
/// serialport-rs's COMPORT-class enumeration misses.
#[cfg(windows)]
fn serialcomm_ports() -> Vec<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("HARDWARE\\DEVICEMAP\\SERIALCOMM")
        .map(|k| {
            k.enum_values()
                .filter_map(|v| v.ok())
                .map(|(_, val)| val.to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn serialcomm_ports() -> Vec<String> {
    Vec::new()
}

/// The strongest Windows fallback: enumerate the global DOS device names.
/// A port name like COM20 IS a DOS-device symlink — that is what
/// `CreateFile("\\.\COM20")` resolves through — so anything openable is
/// listed here, whatever its driver registered (or didn't). This is what
/// catches com0com on machines where even SERIALCOMM is absent.
#[cfg(windows)]
fn dos_device_ports() -> Vec<String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn QueryDosDeviceW(device: *const u16, target: *mut u16, ucch_max: u32) -> u32;
    }
    // All DOS device names on a typical system fit well inside 256K chars;
    // grow once on ERROR_INSUFFICIENT_BUFFER just in case.
    let mut cap = 1usize << 16;
    loop {
        let mut buf: Vec<u16> = vec![0; cap];
        let n = unsafe { QueryDosDeviceW(std::ptr::null(), buf.as_mut_ptr(), buf.len() as u32) };
        if n == 0 {
            if cap < (1 << 20) {
                cap <<= 2;
                continue;
            }
            return Vec::new();
        }
        let mut out = Vec::new();
        for chunk in buf[..n as usize].split(|&c| c == 0) {
            if chunk.len() < 4 || chunk.len() > 8 {
                continue;
            }
            let s = String::from_utf16_lossy(chunk);
            if let Some(digits) = s.strip_prefix("COM") {
                if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
                    out.push(s);
                }
            }
        }
        return out;
    }
}

#[cfg(not(windows))]
fn dos_device_ports() -> Vec<String> {
    Vec::new()
}

/// Enumerate the serial ports present right now. Cheap enough to call on
/// every drawer open / refresh click.
#[tauri::command]
pub fn serial_list_ports() -> Vec<SerialPortInfo> {
    let mut out: Vec<SerialPortInfo> = serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            let (kind, product) = match p.port_type {
                serialport::SerialPortType::UsbPort(u) => {
                    ("usb".to_string(), u.product.unwrap_or_default())
                }
                serialport::SerialPortType::BluetoothPort => ("bluetooth".into(), String::new()),
                serialport::SerialPortType::PciPort => ("pci".into(), String::new()),
                serialport::SerialPortType::Unknown => ("unknown".into(), String::new()),
            };
            SerialPortInfo { name: p.port_name, kind, product }
        })
        .collect();
    // Fallbacks for ports the class scan misses (com0com and friends):
    // SERIALCOMM registry entries, then the raw DOS device namespace.
    for name in serialcomm_ports().into_iter().chain(dos_device_ports()) {
        if !out.iter().any(|p| p.name.eq_ignore_ascii_case(&name)) {
            out.push(SerialPortInfo { name, kind: "unknown".into(), product: String::new() });
        }
    }
    // USB adapters first (that's almost always the cable the user just
    // plugged in), then natural name order.
    out.sort_by(|a, b| {
        let rank = |k: &str| if k == "usb" { 0 } else { 1 };
        rank(&a.kind).cmp(&rank(&b.kind)).then(a.name.cmp(&b.name))
    });
    out
}

#[derive(Deserialize)]
pub struct OpenSerialArgs {
    pub label: String,
    #[serde(flatten)]
    pub spec: SerialSpec,
}

#[tauri::command]
pub async fn open_serial_session(
    app: AppHandle,
    args: OpenSerialArgs,
    mgr: State<'_, SessionManager>,
) -> Result<ConnectionInfo> {
    let info = match mgr.open_serial_session(&args.spec, args.label).await {
        Ok(info) => {
            crate::log_info!(
                crate::logs::categories::SESSION, "serial session opened",
                "session": info.id.to_string(), "port": args.spec.port,
                "baud": args.spec.baud,
            );
            info
        }
        Err(e) => {
            crate::log_error!(
                crate::logs::categories::SESSION, "serial session failed to open",
                "port": args.spec.port, "error": e.to_string(),
            );
            return Err(e);
        }
    };

    let id = info.id;
    let mut rx = mgr.subscribe(id).await?;
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = app_clone.emit(EV_DATA, DataEvent { id, data: chunk });
        }
        crate::log_info!(
            crate::logs::categories::SESSION, "serial session closed",
            "session": id.to_string(),
        );
        let _ = app_clone.emit(EV_CLOSED, ClosedEvent { id, reason: "eof".into() });
    });

    Ok(info)
}

// --- saved profiles ------------------------------------------------------

#[tauri::command]
pub async fn serial_profile_list(
    store: State<'_, SerialProfileStore>,
) -> Result<Vec<SerialProfile>> {
    store.list().await
}

#[derive(Deserialize)]
pub struct SaveSerialProfileArgs {
    #[serde(flatten)]
    pub profile: NewSerialProfile,
}

#[tauri::command]
pub async fn serial_profile_save(
    args: SaveSerialProfileArgs,
    store: State<'_, SerialProfileStore>,
) -> Result<SerialProfile> {
    store.insert(args.profile).await
}

#[derive(Deserialize)]
pub struct UpdateSerialProfileArgs {
    pub id: Uuid,
    #[serde(flatten)]
    pub patch: SerialProfileUpdate,
}

#[tauri::command]
pub async fn serial_profile_update(
    args: UpdateSerialProfileArgs,
    store: State<'_, SerialProfileStore>,
) -> Result<SerialProfile> {
    store.update(args.id, args.patch).await
}

#[derive(Deserialize)]
pub struct SerialIdArgs {
    pub id: Uuid,
}

#[tauri::command]
pub async fn serial_profile_delete(
    args: SerialIdArgs,
    store: State<'_, SerialProfileStore>,
) -> Result<()> {
    store.delete(args.id).await
}

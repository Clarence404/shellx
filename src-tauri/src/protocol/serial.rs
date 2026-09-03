//! Serial-port session driver. Mirrors `local_pty.rs`: a background task
//! owns the port, bytes read are pushed to `subs[id]` (the IPC layer's
//! subscriber emits `session:data`), and writes/close arrive over an mpsc
//! command channel. Resize is meaningless on a raw serial line and is
//! simply absent from the command set.

use crate::error::{Error, Result};
use crate::session::{ConnectionId, ConnectionInfo, ConnectionKind, ConnectionState};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

/// Everything needed to open the port. Field spellings are the frontend's
/// (camelCase via serde) so the form can pass its state straight through.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialSpec {
    pub port: String,
    pub baud: u32,
    /// 5..=8
    pub data_bits: u8,
    /// 1 or 2
    pub stop_bits: u8,
    /// "none" | "even" | "odd"
    pub parity: String,
    /// "none" | "rtscts" | "xonxoff"
    pub flow: String,
}

impl SerialSpec {
    fn data_bits(&self) -> serialport::DataBits {
        match self.data_bits {
            5 => serialport::DataBits::Five,
            6 => serialport::DataBits::Six,
            7 => serialport::DataBits::Seven,
            _ => serialport::DataBits::Eight,
        }
    }
    fn stop_bits(&self) -> serialport::StopBits {
        match self.stop_bits {
            2 => serialport::StopBits::Two,
            _ => serialport::StopBits::One,
        }
    }
    fn parity(&self) -> serialport::Parity {
        match self.parity.as_str() {
            "even" => serialport::Parity::Even,
            "odd" => serialport::Parity::Odd,
            _ => serialport::Parity::None,
        }
    }
    fn flow(&self) -> serialport::FlowControl {
        match self.flow.as_str() {
            "rtscts" => serialport::FlowControl::Hardware,
            "xonxoff" => serialport::FlowControl::Software,
            _ => serialport::FlowControl::None,
        }
    }
}

pub struct SerialHandle {
    pub info: ConnectionInfo,
    writer: mpsc::Sender<SerialCmd>,
}

enum SerialCmd {
    Bytes(Vec<u8>),
    Close,
}

impl SerialHandle {
    pub async fn close(&self) {
        let _ = self.writer.send(SerialCmd::Close).await;
    }

    /// Same contract as `LocalPtyHandle::writer_clone`: lets `SessionManager`
    /// drop the map lock before awaiting a channel send.
    pub fn writer_clone(&self) -> SerialWriter {
        SerialWriter(self.writer.clone())
    }
}

pub struct SerialWriter(mpsc::Sender<SerialCmd>);

impl SerialWriter {
    pub async fn send_bytes(&self, data: &[u8]) -> Result<()> {
        self.0
            .send(SerialCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed)
    }

    pub async fn send_close(&self) {
        let _ = self.0.send(SerialCmd::Close).await;
    }
}

/// Opens the serial port synchronously (fast, local) and spawns the driver.
/// Returns an error with the OS message when the port is missing or busy —
/// the two failure modes that dominate serial work.
pub async fn spawn_serial(
    spec: &SerialSpec,
    session_id: Uuid,
    label: String,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    inner_serial: Arc<Mutex<HashMap<Uuid, SerialHandle>>>,
) -> Result<SerialHandle> {
    let port = serialport::new(&spec.port, spec.baud)
        .data_bits(spec.data_bits())
        .stop_bits(spec.stop_bits())
        .parity(spec.parity())
        .flow_control(spec.flow())
        // The reader thread polls: short timeouts keep close latency low
        // without busy-spinning.
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| Error::Protocol(format!("open {}: {}", spec.port, e)))?;

    let reader = port
        .try_clone()
        .map_err(|e| Error::Protocol(format!("clone {}: {}", spec.port, e)))?;

    let (writer_tx, writer_rx) = mpsc::channel::<SerialCmd>(64);

    let info = ConnectionInfo {
        id: session_id,
        label,
        kind: ConnectionKind::Serial,
        host_id: None,
        state: ConnectionState::Active,
    };

    tokio::spawn(serial_driver_loop(
        session_id,
        reader,
        port,
        writer_rx,
        subs.clone(),
        inner_serial.clone(),
    ));

    Ok(SerialHandle {
        info,
        writer: writer_tx,
    })
}

async fn serial_driver_loop(
    id: Uuid,
    reader: Box<dyn serialport::SerialPort>,
    port: Box<dyn serialport::SerialPort>,
    mut cmds: mpsc::Receiver<SerialCmd>,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    inner_serial: Arc<Mutex<HashMap<Uuid, SerialHandle>>>,
) {
    // Blocking reader thread. A read timeout is normal (line idle) and just
    // re-polls; any other error means the device went away (USB unplugged).
    //
    // The `stop` flag is load-bearing: on a read timeout the thread would
    // otherwise loop straight back into a blocking read and never notice
    // that the session closed — leaving the OS port handle open, so the
    // next open of the same port fails with "access denied". Checking the
    // flag on every iteration lets the handle drop within one timeout
    // (100 ms) of Close.
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_reader = stop.clone();
    let (read_tx, mut read_rx) = mpsc::channel::<Vec<u8>>(64);
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        loop {
            if stop_reader.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if read_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => continue,
                Err(_) => break,
            }
        }
    });

    // Blocking writer thread owns the port's write half.
    let (wtx, mut wrx) = mpsc::channel::<Vec<u8>>(64);
    tokio::task::spawn_blocking(move || {
        let mut port = port;
        while let Some(bytes) = wrx.blocking_recv() {
            if std::io::Write::write_all(&mut port, &bytes).is_err() {
                break;
            }
        }
    });

    loop {
        tokio::select! {
            cmd = cmds.recv() => match cmd {
                Some(SerialCmd::Bytes(b)) => {
                    let _ = wtx.send(b).await;
                }
                Some(SerialCmd::Close) | None => break,
            },
            chunk = read_rx.recv() => match chunk {
                Some(bytes) => {
                    let tx = subs.lock().await.get(&id).cloned();
                    if let Some(tx) = tx {
                        let _ = tx.send(bytes).await;
                    }
                }
                // Reader exited: device unplugged or port force-closed.
                None => break,
            },
        }
    }

    // Tell the reader thread to stop before we return, so it drops its
    // cloned port handle (within one read timeout) instead of spinning on
    // a closed session and holding the OS port open against reconnects.
    stop.store(true, std::sync::atomic::Ordering::Relaxed);

    // Same teardown contract as local_pty: dropping the subs sender makes
    // the IPC subscriber emit connection:closed.
    subs.lock().await.remove(&id);
    inner_serial.lock().await.remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serial_handle_is_send() {
        fn assert_send<T: Send>() {}
        assert_send::<SerialHandle>();
    }

    #[test]
    fn spec_maps_enum_fields() {
        let spec = SerialSpec {
            port: "COM9".into(),
            baud: 115200,
            data_bits: 7,
            stop_bits: 2,
            parity: "even".into(),
            flow: "rtscts".into(),
        };
        assert!(matches!(spec.data_bits(), serialport::DataBits::Seven));
        assert!(matches!(spec.stop_bits(), serialport::StopBits::Two));
        assert!(matches!(spec.parity(), serialport::Parity::Even));
        assert!(matches!(spec.flow(), serialport::FlowControl::Hardware));
        // Unknown strings and out-of-range bits fall back to 8-N-1-none.
        let dflt = SerialSpec { data_bits: 9, parity: "?".into(), flow: "?".into(), stop_bits: 3, ..spec };
        assert!(matches!(dflt.data_bits(), serialport::DataBits::Eight));
        assert!(matches!(dflt.stop_bits(), serialport::StopBits::One));
        assert!(matches!(dflt.parity(), serialport::Parity::None));
        assert!(matches!(dflt.flow(), serialport::FlowControl::None));
    }
}

use crate::error::{Error, Result};
use crate::session::{ConnectionId, ConnectionInfo, ConnectionKind, ConnectionState};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

pub struct LocalPtyHandle {
    pub info: ConnectionInfo,
    writer: mpsc::Sender<LocalCmd>,
}

enum LocalCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

impl LocalPtyHandle {
    pub async fn write(&self, data: &[u8]) -> Result<()> {
        self.writer
            .send(LocalCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed)
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.writer
            .send(LocalCmd::Resize(cols, rows))
            .await
            .map_err(|_| Error::Closed)
    }

    pub async fn close(&self) {
        let _ = self.writer.send(LocalCmd::Close).await;
    }

    /// Returns a cheap sender clone that can be held without holding the
    /// `local_sessions` mutex. Used by `SessionManager` so the write/resize/
    /// close paths can drop the map lock before awaiting the channel send.
    pub fn writer_clone(&self) -> LocalPtyWriter {
        LocalPtyWriter(self.writer.clone())
    }
}

/// Cheap cloneable handle to the local PTY's command channel. Lets callers
/// send commands without holding the `local_sessions` mutex across an await.
pub struct LocalPtyWriter(mpsc::Sender<LocalCmd>);

impl LocalPtyWriter {
    pub async fn send_bytes(&self, data: &[u8]) -> Result<()> {
        self.0
            .send(LocalCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed)
    }

    pub async fn send_resize(&self, cols: u16, rows: u16) -> Result<()> {
        self.0
            .send(LocalCmd::Resize(cols, rows))
            .await
            .map_err(|_| Error::Closed)
    }

    pub async fn send_close(&self) {
        let _ = self.0.send(LocalCmd::Close).await;
    }
}

#[cfg(test)]
impl LocalPtyHandle {
    /// Creates a dummy `LocalPtyHandle` without spawning a real PTY process.
    /// Useful in unit tests that only need to verify map insertion / removal
    /// logic without a real shell or a Tauri `AppHandle`.
    pub fn new_for_test(info: ConnectionInfo) -> Self {
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        Self { info, writer: tx }
    }
}

/// Spawns a local PTY process running `shell` and returns a `LocalPtyHandle`
/// whose lifetime is tied to the background driver task.
///
/// The driver task:
/// - reads stdout/stderr from the PTY master (blocking, in spawn_blocking)
/// - pushes chunks to `subs[session_id]` AND emits `session:data` Tauri events
/// - on process exit or `LocalCmd::Close`, emits `connection:closed` and
///   removes the session from both `subs` and `inner_local`
pub async fn spawn_local_pty(
    shell: &str,
    session_id: Uuid,
    label: String,
    _app: AppHandle,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    inner_local: Arc<Mutex<HashMap<Uuid, LocalPtyHandle>>>,
) -> Result<LocalPtyHandle> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| Error::Protocol(format!("openpty: {e}")))?;

    let cmd = CommandBuilder::new(shell);
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| Error::Protocol(format!("spawn {shell}: {e}")))?;
    // Drop the slave end — on some platforms (notably macOS) keeping it
    // open prevents the reader from ever seeing EOF when the child exits.
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| Error::Protocol(format!("clone_reader: {e}")))?;

    let (writer_tx, writer_rx) = mpsc::channel::<LocalCmd>(64);

    let info = ConnectionInfo {
        id: session_id,
        label,
        kind: ConnectionKind::Local,
        host_id: None,
        state: ConnectionState::Active,
    };

    let subs_driver = subs.clone();
    let inner_driver = inner_local.clone();
    tokio::spawn(local_driver_loop(
        session_id,
        reader,
        pair.master,
        child,
        writer_rx,
        subs_driver,
        inner_driver,
    ));

    Ok(LocalPtyHandle {
        info,
        writer: writer_tx,
    })
}

async fn local_driver_loop(
    id: Uuid,
    reader: Box<dyn std::io::Read + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    mut cmds: mpsc::Receiver<LocalCmd>,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    inner_local: Arc<Mutex<HashMap<Uuid, LocalPtyHandle>>>,
) {
    // Obtain writer once — take_writer() can only be called once per master.
    let mut pty_writer = match master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            log::error!("local_pty: take_writer failed: {e}");
            return;
        }
    };
    // Read loop: blocking I/O in spawn_blocking; posts chunks via an mpsc
    // channel so we can select! with the command channel.
    let (read_tx, mut read_rx) = mpsc::channel::<Vec<u8>>(64);
    tokio::task::spawn_blocking(move || {
        let mut buf = [0u8; 4096];
        let mut reader = reader;
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if read_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Write channel: a dedicated spawn_blocking task owns the writer so
    // take_writer() is called exactly once and write_all runs without
    // blocking the Tokio runtime.
    let (wtx, mut wrx) = mpsc::channel::<Vec<u8>>(64);
    tokio::task::spawn_blocking(move || {
        while let Some(bytes) = wrx.blocking_recv() {
            if std::io::Write::write_all(&mut pty_writer, &bytes).is_err() {
                break;
            }
        }
    });

    loop {
        tokio::select! {
            cmd = cmds.recv() => match cmd {
                Some(LocalCmd::Bytes(b)) => {
                    let _ = wtx.send(b).await;
                }
                Some(LocalCmd::Resize(cols, rows)) => {
                    let _ = master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
                }
                Some(LocalCmd::Close) | None => {
                    let _ = child.kill();
                    break;
                }
            },
            chunk = read_rx.recv() => match chunk {
                Some(bytes) => {
                    // Forward to subscriber — the subscriber task in the IPC
                    // layer emits session:data to the frontend.
                    let tx = subs.lock().await.get(&id).cloned();
                    if let Some(tx) = tx {
                        let _ = tx.send(bytes).await;
                    }
                }
                None => break, // reader task exited — child has exited
            },
        }
    }

    // Drop the subs sender — the subscriber task's rx.recv() returns None,
    // which causes it to emit connection:closed to the frontend.
    subs.lock().await.remove(&id);
    inner_local.lock().await.remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_pty_handle_is_send() {
        fn assert_send<T: Send>() {}
        // Compile-time check that LocalPtyHandle can cross thread boundaries.
        assert_send::<LocalPtyHandle>();
    }
}

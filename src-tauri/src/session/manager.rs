//! Owns live connections keyed by UUID; drives byte pumping between the
//! underlying shell channel and subscribers.
//!
//! Note: v0.3 introduces the `Connection` trait (`protocol::Connection`) so
//! a single connection can host both a shell channel and (from Task 2) an
//! SFTP subsystem. `open_connection` establishes the transport-level
//! connection only; `open_shell` lazily opens the shell channel and spawns
//! the byte-pumping driver task. The IPC layer currently calls both back to
//! back to preserve the v0.2 UX (connect always opens a terminal).

use crate::error::{Error, Result};
use crate::protocol::{AuthConfig, Connection, ShellHandle, SftpHandle, SshProtocol};
use crate::session::{ConnectionId, ConnectionInfo, ConnectionKind, ConnectionState};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

struct LiveConnection {
    info: ConnectionInfo,
    conn: Box<dyn Connection>,
    shell: Option<ShellDriver>,
    sftp: Option<SftpHandle>,
}

/// Handle to the background task pumping bytes for this connection's shell
/// channel. Dropping the `Sender` (e.g. by removing the owning
/// `LiveConnection` from the map without sending `Close`) causes
/// `shell_driver_loop`'s `writes.recv()` to resolve to `None`, which the
/// loop treats the same as an explicit `Close`.
struct ShellDriver {
    writer: mpsc::Sender<ShellCmd>,
}

enum ShellCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

/// Owns every live connection (currently just SSH) keyed by `ConnectionId`.
/// Each connection's shell, once opened, is driven by its own background
/// task (`shell_driver_loop`) that pumps bytes between the underlying
/// transport and whatever subscriber is listening; the manager itself never
/// touches the transport directly once `open_shell` hands it off, so its
/// mutex is never held across I/O.
pub struct SessionManager {
    inner: Arc<Mutex<HashMap<ConnectionId, LiveConnection>>>,
    // For subscribe(): map id -> channel to forward read bytes to. Only a
    // single consumer per connection is supported (see driver_loop invariant
    // carried over from v0.1/v0.2).
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            subs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Establishes the transport-level SSH connection and authenticates,
    /// but does not open any channel (shell or SFTP) yet.
    pub async fn open_connection(
        &self,
        host: &str,
        port: u16,
        auth: AuthConfig,
        label: String,
        host_id: Option<Uuid>,
    ) -> Result<ConnectionInfo> {
        let connection = SshProtocol::connect(host, port, auth).await?;
        let id = Uuid::new_v4();
        let info = ConnectionInfo {
            id,
            label,
            kind: ConnectionKind::Ssh,
            host_id,
            state: ConnectionState::Active,
        };
        let live = LiveConnection {
            info: info.clone(),
            conn: Box::new(connection),
            shell: None,
            sftp: None,
        };
        self.inner.lock().await.insert(id, live);
        Ok(info)
    }

    /// Lazily opens the shell channel on an already-established connection
    /// and spawns the byte-pumping driver task. Idempotent: calling it again
    /// once a shell is already open is a no-op.
    pub async fn open_shell(&self, id: ConnectionId) -> Result<()> {
        // Take the LiveConnection out of the map so we can await on it
        // (channel_open_session, request_pty, request_shell) without
        // holding the map mutex across that I/O.
        let mut live = {
            let mut map = self.inner.lock().await;
            map.remove(&id).ok_or(Error::Closed)?
        };
        if live.shell.is_some() {
            // Already open — put back and return.
            self.inner.lock().await.insert(id, live);
            return Ok(());
        }
        let shell_handle = match live.conn.open_shell().await {
            Ok(h) => h,
            Err(e) => {
                // Put the connection back so it isn't silently dropped on a
                // failed attempt; the caller can retry or close it.
                self.inner.lock().await.insert(id, live);
                return Err(e);
            }
        };
        let (writer_tx, writer_rx) = mpsc::channel::<ShellCmd>(64);
        let subs_arc = self.subs.clone();
        let inner_arc = self.inner.clone();
        tokio::spawn(shell_driver_loop(
            id,
            shell_handle,
            writer_rx,
            subs_arc,
            inner_arc,
        ));
        live.shell = Some(ShellDriver { writer: writer_tx });
        self.inner.lock().await.insert(id, live);
        Ok(())
    }

    pub async fn write(&self, id: ConnectionId, data: &[u8]) -> Result<()> {
        let writer = self.shell_writer(id).await?;
        writer
            .send(ShellCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed)?;
        Ok(())
    }

    pub async fn resize(&self, id: ConnectionId, cols: u16, rows: u16) -> Result<()> {
        let writer = self.shell_writer(id).await?;
        writer
            .send(ShellCmd::Resize(cols, rows))
            .await
            .map_err(|_| Error::Closed)?;
        Ok(())
    }

    async fn shell_writer(&self, id: ConnectionId) -> Result<mpsc::Sender<ShellCmd>> {
        let map = self.inner.lock().await;
        let live = map.get(&id).ok_or(Error::Closed)?;
        let shell = live.shell.as_ref().ok_or(Error::Closed)?;
        Ok(shell.writer.clone())
    }

    pub async fn subscribe(&self, id: ConnectionId) -> Result<mpsc::Receiver<Vec<u8>>> {
        let map = self.inner.lock().await;
        if !map.contains_key(&id) {
            return Err(Error::Closed);
        }
        drop(map);
        let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
        self.subs.lock().await.insert(id, tx);
        Ok(rx)
    }

    pub async fn close(&self, id: ConnectionId) -> Result<()> {
        let live = self.inner.lock().await.remove(&id);
        if let Some(mut live) = live {
            if let Some(shell) = live.shell.take() {
                // Tell the driver to close the channel + exit its loop.
                let _ = shell.writer.send(ShellCmd::Close).await;
            }
            // Whole-connection teardown: send SSH_MSG_DISCONNECT gracefully.
            // Runs whether or not a shell was ever opened.
            let _ = live.conn.disconnect().await;
        }
        self.subs.lock().await.remove(&id);
        Ok(())
    }

    pub async fn list(&self) -> Vec<ConnectionInfo> {
        self.inner
            .lock()
            .await
            .values()
            .map(|s| s.info.clone())
            .collect()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Per-connection background task. Owns the `ShellHandle` exclusively (the
/// `SessionManager`'s mutex is never held while this runs) and pumps bytes
/// between it and whichever channel is currently registered.
async fn shell_driver_loop(
    id: ConnectionId,
    mut shell: ShellHandle,
    mut writes: mpsc::Receiver<ShellCmd>,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    inner: Arc<Mutex<HashMap<ConnectionId, LiveConnection>>>,
) {
    let mut read_buf = Vec::with_capacity(4096);
    loop {
        tokio::select! {
            cmd = writes.recv() => match cmd {
                Some(ShellCmd::Bytes(b)) => {
                    let _ = shell.write_input(&b).await;
                }
                Some(ShellCmd::Resize(c, r)) => {
                    let _ = shell.resize(c, r).await;
                }
                Some(ShellCmd::Close) | None => {
                    let _ = shell.close().await;
                    break;
                }
            },
            read = shell.read_output(&mut read_buf) => match read {
                Ok(0) => break,
                Ok(_) => {
                    // Take the accumulated bytes and forward them if (and
                    // only if) a subscriber is currently registered. Reads
                    // that happen before anyone calls subscribe() are
                    // dropped -- an explicit v0.1 simplification, carried
                    // forward.
                    let chunk = std::mem::take(&mut read_buf);
                    let tx = subs.lock().await.get(&id).cloned();
                    if let Some(tx) = tx {
                        let _ = tx.send(chunk).await;
                    }
                }
                Err(_) => break,
            },
        }
    }
    // Every exit path above (remote EOF, I/O error, explicit Close, or the
    // write sender being dropped) lands here. Release this connection's
    // entry from both maps so the IPC bridge's `rx.recv()` loop terminates
    // (letting it emit `EV_CLOSED`) and `list()` stops reporting a dead
    // connection as live. `close()` already removes from `inner` itself;
    // the second removal here is a harmless no-op in that case.
    subs.lock().await.remove(&id);
    inner.lock().await.remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{AuthConfig, AuthMethod};

    async fn open_ssh_with_shell(
        mgr: &SessionManager,
        port: u16,
        label: &str,
    ) -> ConnectionInfo {
        let auth = AuthConfig {
            username: "chen".into(),
            method: AuthMethod::Password("pw".into()),
        };
        let info = mgr
            .open_connection("127.0.0.1", port, auth, label.into(), None)
            .await
            .unwrap();
        mgr.open_shell(info.id).await.unwrap();
        info
    }

    #[tokio::test]
    async fn open_and_close_ssh_session_tracks_state() {
        let (port, _handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let info = open_ssh_with_shell(&mgr, port, "test").await;
        assert_eq!(mgr.list().await.len(), 1);
        assert_eq!(info.label, "test");
        mgr.close(info.id).await.unwrap();
        assert_eq!(mgr.list().await.len(), 0);
    }

    #[tokio::test]
    async fn write_is_forwarded_to_subscriber() {
        let (port, _handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let info = open_ssh_with_shell(&mgr, port, "test").await;

        let mut rx = mgr.subscribe(info.id).await.unwrap();
        mgr.write(info.id, b"hello\n").await.unwrap();

        let chunk = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv())
            .await
            .expect("timed out waiting for echoed data")
            .expect("subscription channel closed unexpectedly");
        assert!(
            chunk.windows(5).any(|w| w == b"hello"),
            "expected chunk to contain b\"hello\", got {chunk:?}"
        );

        mgr.close(info.id).await.unwrap();
    }

    #[tokio::test]
    async fn session_closes_when_driver_exits() {
        let (port, _handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let info = open_ssh_with_shell(&mgr, port, "test").await;

        let mut rx = mgr.subscribe(info.id).await.unwrap();

        // Drive the loop to its Close exit path (stands in for a remote EOF
        // / I/O-error exit -- all three converge on the same cleanup code).
        mgr.close(info.id).await.unwrap();

        // The subscription channel's Sender must have been dropped from
        // `subs` by the driver loop, so recv() resolves to None instead of
        // hanging forever (the bug this test guards against: the IPC
        // bridge's `while let Some(chunk) = rx.recv().await` never seeing
        // a close and staying parked forever).
        let closed = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv())
            .await
            .expect("timed out waiting for subscription channel to close");
        assert!(closed.is_none(), "expected subscription channel to close");

        // `inner` must also have released the id so list() stops reporting
        // a dead connection as alive.
        assert!(
            mgr.list().await.is_empty(),
            "expected no live connections after driver exit"
        );
    }

    #[tokio::test]
    async fn driver_loop_cleans_up_on_remote_eof() {
        let (port, server_handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let info = open_ssh_with_shell(&mgr, port, "eof-test").await;
        let mut rx = mgr.subscribe(info.id).await.unwrap();

        // Force the server to drop the connection -- simulates remote EOF.
        server_handle.abort();
        let _ = server_handle.await;

        // The driver_loop's read side should see EOF/error within a couple
        // seconds and clean up subs + inner. Prove it by waiting for the
        // subscription receiver to close (returns None) and by asserting
        // list() is empty.
        let recv_result = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv()).await;
        assert!(
            recv_result.is_ok(),
            "subscription receiver should close within 3s of remote EOF"
        );
        assert!(
            recv_result.unwrap().is_none(),
            "receiver should return None when driver_loop cleans up subs"
        );
        assert!(
            mgr.list().await.is_empty(),
            "list should be empty after driver_loop cleans up inner"
        );
    }
}

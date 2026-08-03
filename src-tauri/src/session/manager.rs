use crate::error::{Error, Result};
use crate::protocol::{
    ssh::{SshProtocol, SshSession},
    AuthConfig,
};
use crate::session::{SessionId, SessionInfo, SessionKind};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

struct LiveSession {
    info: SessionInfo,
    writer: mpsc::Sender<WriteCmd>,
}

enum WriteCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

/// Owns every live session (currently just SSH) keyed by `SessionId`. Each
/// session is driven by its own background task (`driver_loop`) that pumps
/// bytes between the underlying transport and whatever subscriber is
/// listening; the manager itself never touches the transport directly once
/// `open_ssh` hands it off, so its mutex is never held across I/O.
pub struct SessionManager {
    inner: Arc<Mutex<HashMap<SessionId, LiveSession>>>,
    // For subscribe(): map id -> channel to forward read bytes to. v0.1
    // supports a single consumer per session (see driver_loop invariant 5).
    subs: Arc<Mutex<HashMap<SessionId, mpsc::Sender<Vec<u8>>>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            subs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn open_ssh(
        &self,
        host: &str,
        port: u16,
        auth: AuthConfig,
        label: String,
    ) -> Result<SessionInfo> {
        let session = SshProtocol::connect(host, port, auth).await?;
        let id = uuid::Uuid::new_v4();
        let info = SessionInfo {
            id,
            label,
            kind: SessionKind::Ssh,
        };
        let (write_tx, write_rx) = mpsc::channel::<WriteCmd>(64);
        let subs = self.subs.clone();
        tokio::spawn(driver_loop(id, session, write_rx, subs));
        let mut map = self.inner.lock().await;
        map.insert(
            id,
            LiveSession {
                info: info.clone(),
                writer: write_tx,
            },
        );
        Ok(info)
    }

    pub async fn write(&self, id: SessionId, data: &[u8]) -> Result<()> {
        let writer = {
            let map = self.inner.lock().await;
            map.get(&id).ok_or(Error::Closed)?.writer.clone()
        };
        writer
            .send(WriteCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed)?;
        Ok(())
    }

    pub async fn resize(&self, id: SessionId, cols: u16, rows: u16) -> Result<()> {
        let writer = {
            let map = self.inner.lock().await;
            map.get(&id).ok_or(Error::Closed)?.writer.clone()
        };
        writer
            .send(WriteCmd::Resize(cols, rows))
            .await
            .map_err(|_| Error::Closed)?;
        Ok(())
    }

    pub async fn subscribe(&self, id: SessionId) -> Result<mpsc::Receiver<Vec<u8>>> {
        let map = self.inner.lock().await;
        if !map.contains_key(&id) {
            return Err(Error::Closed);
        }
        drop(map);
        let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
        self.subs.lock().await.insert(id, tx);
        Ok(rx)
    }

    pub async fn close(&self, id: SessionId) -> Result<()> {
        let writer = self.inner.lock().await.remove(&id).map(|s| s.writer);
        if let Some(writer) = writer {
            let _ = writer.send(WriteCmd::Close).await;
        }
        self.subs.lock().await.remove(&id);
        Ok(())
    }

    pub async fn list(&self) -> Vec<SessionInfo> {
        self.inner.lock().await.values().map(|s| s.info.clone()).collect()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Per-session background task. Owns the `SshSession` exclusively (the
/// `SessionManager`'s mutex is never held while this runs) and pumps bytes
/// between it and whichever channel is currently registered.
async fn driver_loop(
    id: SessionId,
    mut session: SshSession,
    mut writes: mpsc::Receiver<WriteCmd>,
    subs: Arc<Mutex<HashMap<SessionId, mpsc::Sender<Vec<u8>>>>>,
) {
    let mut read_buf = Vec::with_capacity(4096);
    loop {
        tokio::select! {
            cmd = writes.recv() => match cmd {
                Some(WriteCmd::Bytes(b)) => {
                    let _ = session.write_input(&b).await;
                }
                Some(WriteCmd::Resize(c, r)) => {
                    let _ = session.resize(c, r).await;
                }
                Some(WriteCmd::Close) | None => {
                    let _ = session.close().await;
                    break;
                }
            },
            read = session.read_output(&mut read_buf) => match read {
                Ok(0) => break,
                Ok(_) => {
                    // Take the accumulated bytes and forward them if (and
                    // only if) a subscriber is currently registered. Reads
                    // that happen before anyone calls subscribe() are
                    // dropped -- an explicit v0.1 simplification.
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{AuthConfig, AuthMethod};

    #[tokio::test]
    async fn open_and_close_ssh_session_tracks_state() {
        let (port, _handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let auth = AuthConfig {
            username: "chen".into(),
            method: AuthMethod::Password("pw".into()),
        };
        let info = mgr
            .open_ssh("127.0.0.1", port, auth, "test".into())
            .await
            .unwrap();
        assert_eq!(mgr.list().await.len(), 1);
        assert_eq!(info.label, "test");
        mgr.close(info.id).await.unwrap();
        assert_eq!(mgr.list().await.len(), 0);
    }

    #[tokio::test]
    async fn write_is_forwarded_to_subscriber() {
        let (port, _handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let auth = AuthConfig {
            username: "chen".into(),
            method: AuthMethod::Password("pw".into()),
        };
        let info = mgr
            .open_ssh("127.0.0.1", port, auth, "test".into())
            .await
            .unwrap();

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
}

//! Live FTP connections, keyed the way `SessionManager` keys SSH ones.
//!
//! One mutex per connection rather than one over the map: FTP has a
//! single control channel, so two commands on the same connection must
//! not interleave — but two different servers have no reason to wait for
//! each other.

use super::client::FtpClient;
use crate::error::{Error, Result};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Default, Clone)]
pub struct FtpManager {
    live: Arc<Mutex<HashMap<Uuid, Arc<Mutex<FtpClient>>>>>,
    /// Up to two extra connections per server that serve ONLY the
    /// background cache warming. FTP does one thing at a time per
    /// control channel; when the warm loop shared the browsing
    /// connection, a user's click queued behind whatever the warm was
    /// fetching. On their own connections warming can never delay a
    /// click — and two of them cut the time to warm a directory's
    /// children in half, which is what decides whether the user's
    /// first click lands on the cache.
    warm: Arc<Mutex<HashMap<Uuid, Vec<Arc<Mutex<FtpClient>>>>>>,
    /// SFTP rows in this view are ordinary SSH sessions with no shell,
    /// so what is tracked here is which session belongs to which saved
    /// row. Keeping it on this side rather than in the frontend means a
    /// reload cannot orphan a live SSH connection.
    sftp: Arc<Mutex<HashMap<Uuid, Uuid>>>,
}

impl FtpManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn insert(&self, id: Uuid, client: FtpClient) {
        self.live.lock().await.insert(id, Arc::new(Mutex::new(client)));
    }

    pub async fn get(&self, id: Uuid) -> Result<Arc<Mutex<FtpClient>>> {
        self.live
            .lock()
            .await
            .get(&id)
            .cloned()
            .ok_or_else(|| Error::Protocol(format!("no live FTP session {id}")))
    }

    /// The warm-connection pool for a server (possibly empty).
    pub async fn warm_pool(&self, id: Uuid) -> Vec<Arc<Mutex<FtpClient>>> {
        self.warm.lock().await.get(&id).cloned().unwrap_or_default()
    }

    /// Adds a warm connection, capped at two per server. The cap is a
    /// backstop — the frontend runs at most two warm fetches at once,
    /// so a third is never asked for.
    pub async fn insert_warm(&self, id: Uuid, client: FtpClient) -> Arc<Mutex<FtpClient>> {
        let arc = Arc::new(Mutex::new(client));
        let mut map = self.warm.lock().await;
        let pool = map.entry(id).or_default();
        if pool.len() < 2 {
            pool.push(arc.clone());
        }
        arc
    }

    /// Records that a saved row is being served by an SSH session.
    pub async fn bind_sftp(&self, host_id: Uuid, session_id: Uuid) {
        self.sftp.lock().await.insert(host_id, session_id);
    }

    /// The SSH session serving this row, if it is an SFTP one.
    pub async fn session_of(&self, host_id: Uuid) -> Option<Uuid> {
        self.sftp.lock().await.get(&host_id).copied()
    }

    /// Forgets the SSH session for a row and hands its id back, so the
    /// caller can close it through the session manager.
    pub async fn take_sftp(&self, host_id: Uuid) -> Option<Uuid> {
        self.sftp.lock().await.remove(&host_id)
    }

    /// Drops the connection, saying goodbye first when the server is
    /// still listening. Never fails: a session the caller wants gone is
    /// gone either way.
    pub async fn close(&self, id: Uuid) {
        let entry = self.live.lock().await.remove(&id);
        if let Some(client) = entry {
            client.lock().await.quit().await;
        }
        let warm = self.warm.lock().await.remove(&id);
        for client in warm.unwrap_or_default() {
            client.lock().await.quit().await;
        }
    }

    /// Every row with something live behind it, of either kind.
    pub async fn ids(&self) -> Vec<Uuid> {
        let mut ids: Vec<Uuid> = self.live.lock().await.keys().copied().collect();
        ids.extend(self.sftp.lock().await.keys().copied());
        ids
    }
}

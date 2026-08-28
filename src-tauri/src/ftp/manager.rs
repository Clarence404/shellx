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

    /// Drops the connection, saying goodbye first when the server is
    /// still listening. Never fails: a session the caller wants gone is
    /// gone either way.
    pub async fn close(&self, id: Uuid) {
        let entry = self.live.lock().await.remove(&id);
        if let Some(client) = entry {
            client.lock().await.quit().await;
        }
    }

    pub async fn ids(&self) -> Vec<Uuid> {
        self.live.lock().await.keys().copied().collect()
    }
}

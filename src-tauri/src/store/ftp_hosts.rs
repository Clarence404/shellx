//! Saved connections for the FTP view.
//!
//! Named for the view, not for the protocol: rows here carry `sftp`,
//! `ftp` or `ftps`, because that view speaks all three.
//!
//! Deliberately not the `hosts` table. A saved host is an SSH machine
//! with a terminal, tunnels and a monitor; a row here is a file endpoint
//! and nothing else. The same physical machine may appear in both, and
//! that is the accepted cost of two lists that never surprise each other
//! when a row is deleted.

use crate::error::{Error, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS ftp_hosts (
  id          TEXT PRIMARY KEY,
  label       TEXT    NOT NULL,
  protocol    TEXT    NOT NULL DEFAULT 'ftp',
  host        TEXT    NOT NULL,
  port        INTEGER NOT NULL DEFAULT 21,
  username    TEXT    NOT NULL,
  charset     TEXT    NOT NULL DEFAULT 'auto',
  passive     INTEGER NOT NULL DEFAULT 1,
  auth_method TEXT    NOT NULL DEFAULT 'password',
  key_path    TEXT,
  tls_mode    TEXT    NOT NULL DEFAULT 'explicit',
  created_at  INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ftp_hosts_sort ON ftp_hosts(sort_order);";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FtpHost {
    pub id: Uuid,
    pub label: String,
    /// "sftp" | "ftp" | "ftps"
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    /// "auto" | "utf8" | "gbk" — meaningless for sftp, which fixes
    /// filenames as UTF-8, and hidden rather than disabled in the form.
    pub charset: String,
    pub passive: bool,
    /// "password" | "publickey" — SFTP only; FTP and FTPS have no
    /// concept of key authentication.
    pub auth_method: String,
    pub key_path: Option<String>,
    /// "explicit" (AUTH TLS on port 21) | "implicit" (TLS from the first
    /// byte, port 990). FTPS only, and not detectable — the two look the
    /// same until one of them fails.
    pub tls_mode: String,
    pub created_at: i64,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewFtpHost {
    pub label: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub charset: Option<String>,
    pub passive: Option<bool>,
    pub auth_method: Option<String>,
    pub key_path: Option<String>,
    pub tls_mode: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct FtpHostUpdate {
    pub label: Option<String>,
    pub protocol: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub charset: Option<String>,
    pub passive: Option<bool>,
    pub auth_method: Option<String>,
    #[serde(default, deserialize_with = "crate::store::hosts::double_option_deserialize")]
    pub key_path: Option<Option<String>>,
    pub tls_mode: Option<String>,
}

#[derive(Clone)]
pub struct FtpHostStore {
    conn: Arc<Mutex<Connection>>,
}

impl FtpHostStore {
    /// Shares the connection `HostStore` opened, the way `TunnelStore`
    /// does — one database file, one migration point.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Result<Self> {
        {
            // `try_lock`, not `blocking_lock`: this runs at startup while
            // nothing else holds the connection, and blocking_lock panics
            // when it happens to be called from inside a runtime.
            let guard = conn
                .try_lock()
                .map_err(|_| Error::Protocol("ftp_hosts: database busy at startup".into()))?;
            guard
                .execute_batch(SCHEMA)
                .map_err(|e| Error::Protocol(format!("ftp_hosts schema: {e}")))?;
        }
        Ok(Self { conn })
    }

    pub async fn list(&self) -> Result<Vec<FtpHost>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, label, protocol, host, port, username, charset, passive, \
                 auth_method, key_path, tls_mode, created_at, sort_order FROM ftp_hosts ORDER BY sort_order",
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        let rows = stmt
            .query_map([], row_to_host)
            .map_err(|e| Error::Protocol(e.to_string()))?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Protocol(e.to_string()))?;
        Ok(rows)
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<FtpHost>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, label, protocol, host, port, username, charset, passive, \
                 auth_method, key_path, tls_mode, created_at, sort_order FROM ftp_hosts WHERE id=?1",
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        let mut rows = stmt
            .query_map(params![id.to_string()], row_to_host)
            .map_err(|e| Error::Protocol(e.to_string()))?;
        match rows.next() {
            Some(r) => Ok(Some(r.map_err(|e| Error::Protocol(e.to_string()))?)),
            None => Ok(None),
        }
    }

    pub async fn insert(&self, new: NewFtpHost) -> Result<FtpHost> {
        let now = now_ms();
        let record = FtpHost {
            id: Uuid::new_v4(),
            label: new.label,
            protocol: new.protocol,
            host: new.host,
            port: new.port,
            username: new.username,
            charset: new.charset.unwrap_or_else(|| "auto".into()),
            passive: new.passive.unwrap_or(true),
            auth_method: new.auth_method.unwrap_or_else(|| "password".into()),
            key_path: new.key_path,
            tls_mode: new.tls_mode.unwrap_or_else(|| "explicit".into()),
            created_at: now,
            sort_order: now,
        };
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO ftp_hosts (id, label, protocol, host, port, username, \
             charset, passive, created_at, sort_order) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                record.id.to_string(), &record.label, &record.protocol, &record.host,
                record.port, &record.username, &record.charset, record.passive as i64,
                record.created_at, record.sort_order,
            ],
        )
        .map_err(|e| Error::Protocol(format!("insert FTP-view connection: {e}")))?;
        Ok(record)
    }

    pub async fn update(&self, id: Uuid, patch: FtpHostUpdate) -> Result<FtpHost> {
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| Error::Protocol(format!("no FTP-view connection {id}")))?;
        let merged = FtpHost {
            label: patch.label.unwrap_or(existing.label),
            protocol: patch.protocol.unwrap_or(existing.protocol),
            host: patch.host.unwrap_or(existing.host),
            port: patch.port.unwrap_or(existing.port),
            username: patch.username.unwrap_or(existing.username),
            charset: patch.charset.unwrap_or(existing.charset),
            passive: patch.passive.unwrap_or(existing.passive),
            auth_method: patch.auth_method.unwrap_or(existing.auth_method),
            key_path: patch.key_path.unwrap_or(existing.key_path),
            tls_mode: patch.tls_mode.unwrap_or(existing.tls_mode),
            ..existing
        };
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE ftp_hosts SET label=?2, protocol=?3, host=?4, port=?5, \
             username=?6, charset=?7, passive=?8 WHERE id=?1",
            params![
                merged.id.to_string(), &merged.label, &merged.protocol, &merged.host,
                merged.port, &merged.username, &merged.charset, merged.passive as i64,
            ],
        )
        .map_err(|e| Error::Protocol(format!("update FTP-view connection: {e}")))?;
        Ok(merged)
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM ftp_hosts WHERE id=?1", params![id.to_string()])
            .map_err(|e| Error::Protocol(format!("delete FTP-view connection: {e}")))?;
        Ok(())
    }
}

fn row_to_host(r: &rusqlite::Row) -> rusqlite::Result<FtpHost> {
    let id: String = r.get(0)?;
    Ok(FtpHost {
        id: Uuid::parse_str(&id).unwrap_or_default(),
        label: r.get(1)?,
        protocol: r.get(2)?,
        host: r.get(3)?,
        port: r.get(4)?,
        username: r.get(5)?,
        charset: r.get(6)?,
        passive: r.get::<_, i64>(7)? != 0,
        auth_method: r.get(8)?,
        key_path: r.get(9)?,
        tls_mode: r.get(10)?,
        created_at: r.get(11)?,
        sort_order: r.get(12)?,
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> FtpHostStore {
        let conn = Connection::open_in_memory().unwrap();
        FtpHostStore::new(Arc::new(Mutex::new(conn))).unwrap()
    }

    fn new_host(label: &str) -> NewFtpHost {
        NewFtpHost {
            label: label.into(),
            protocol: "ftp".into(),
            host: "10.20.1.40".into(),
            port: 21,
            username: "ftpuser".into(),
            charset: None,
            passive: None,
            auth_method: None,
            key_path: None,
            tls_mode: None,
        }
    }

    #[tokio::test]
    async fn insert_defaults_to_auto_and_passive() {
        let s = store();
        let h = s.insert(new_host("产线 A")).await.unwrap();
        assert_eq!(h.charset, "auto");
        assert!(h.passive);
        assert_eq!(s.list().await.unwrap(), vec![h]);
    }

    #[tokio::test]
    async fn update_touches_only_what_was_given() {
        let s = store();
        let h = s.insert(new_host("产线 A")).await.unwrap();
        let patched = s
            .update(h.id, FtpHostUpdate { charset: Some("gbk".into()), ..Default::default() })
            .await
            .unwrap();
        assert_eq!(patched.charset, "gbk");
        assert_eq!(patched.label, "产线 A", "the label was not in the patch");
        assert_eq!(patched.created_at, h.created_at);
    }

    #[tokio::test]
    async fn active_mode_survives_a_round_trip() {
        // A false stored as 0 must not read back as true — old boxes
        // that need active mode would silently get passive.
        let s = store();
        let h = s
            .insert(NewFtpHost { passive: Some(false), ..new_host("old box") })
            .await
            .unwrap();
        assert!(!s.get(h.id).await.unwrap().unwrap().passive);
    }

    #[tokio::test]
    async fn delete_removes_only_that_row() {
        let s = store();
        let a = s.insert(new_host("a")).await.unwrap();
        s.insert(new_host("b")).await.unwrap();
        s.delete(a.id).await.unwrap();
        let left = s.list().await.unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].label, "b");
        assert!(s.get(a.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn updating_a_row_that_is_gone_says_so() {
        let s = store();
        assert!(s.update(Uuid::new_v4(), FtpHostUpdate::default()).await.is_err());
    }
}

use crate::error::{Error, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use uuid::Uuid;

const SCHEMA: &str = include_str!("schema.sql");

#[derive(Debug, Clone, Serialize)]
pub struct HostRecord {
    pub id: Uuid,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub notes: Option<String>,
    pub created_at: i64,
    pub last_connected_at: Option<i64>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewHost {
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct HostUpdate {
    pub label: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    #[serde(default, deserialize_with = "double_option_deserialize")]
    pub notes: Option<Option<String>>,  // None = leave unchanged; Some(None) = clear; Some(Some(s)) = set
}

// Serde support for triple-state Option<Option<T>>.
// Note: this is `std::result::Result` (two generic params), not the crate's
// `Result<T>` alias imported above — the deserializer's error type is
// `D::Error`, unrelated to `crate::error::Error`.
pub fn double_option_deserialize<'de, T, D>(d: D) -> std::result::Result<Option<Option<T>>, D::Error>
where T: serde::Deserialize<'de>, D: serde::Deserializer<'de> {
    serde::Deserialize::deserialize(d).map(Some)
}

pub struct HostStore {
    conn: Arc<Mutex<Connection>>,
}

impl HostStore {
    pub fn open(config_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(config_dir).map_err(Error::Io)?;
        let db_path = config_dir.join("hosts.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| Error::Protocol(format!("open hosts.db: {e}")))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| Error::Protocol(format!("apply schema: {e}")))?;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    pub async fn list(&self) -> Result<Vec<HostRecord>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, label, host, port, username, notes, created_at, last_connected_at, sort_order \
             FROM hosts ORDER BY sort_order ASC"
        ).map_err(|e| Error::Protocol(format!("prepare list: {e}")))?;
        let rows = stmt.query_map([], row_to_record)
            .map_err(|e| Error::Protocol(format!("query list: {e}")))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| Error::Protocol(format!("row list: {e}")))?);
        }
        Ok(out)
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<HostRecord>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, label, host, port, username, notes, created_at, last_connected_at, sort_order \
             FROM hosts WHERE id = ?1"
        ).map_err(|e| Error::Protocol(format!("prepare get: {e}")))?;
        let mut rows = stmt.query_map(params![id.to_string()], row_to_record)
            .map_err(|e| Error::Protocol(format!("query get: {e}")))?;
        match rows.next() {
            Some(r) => Ok(Some(r.map_err(|e| Error::Protocol(format!("row get: {e}")))?)),
            None => Ok(None),
        }
    }

    pub async fn insert(&self, new: NewHost) -> Result<HostRecord> {
        let id = Uuid::new_v4();
        let now = now_ms();
        let record = HostRecord {
            id,
            label: new.label,
            host: new.host,
            port: new.port,
            username: new.username,
            notes: new.notes,
            created_at: now,
            last_connected_at: None,
            sort_order: now,
        };
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO hosts (id, label, host, port, username, notes, created_at, last_connected_at, sort_order) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                record.id.to_string(), &record.label, &record.host, record.port,
                &record.username, &record.notes, record.created_at,
                record.last_connected_at, record.sort_order,
            ],
        ).map_err(|e| Error::Protocol(format!("insert host: {e}")))?;
        Ok(record)
    }

    pub async fn update(&self, id: Uuid, patch: HostUpdate) -> Result<HostRecord> {
        let conn = self.conn.lock().await;
        // Read current
        let current: HostRecord = {
            let mut stmt = conn.prepare(
                "SELECT id, label, host, port, username, notes, created_at, last_connected_at, sort_order \
                 FROM hosts WHERE id = ?1"
            ).map_err(|e| Error::Protocol(format!("prepare update-read: {e}")))?;
            let mut rows = stmt.query_map(params![id.to_string()], row_to_record)
                .map_err(|e| Error::Protocol(format!("query update-read: {e}")))?;
            rows.next()
                .ok_or_else(|| Error::Protocol(format!("host {id} not found")))?
                .map_err(|e| Error::Protocol(format!("row update-read: {e}")))?
        };
        let merged = HostRecord {
            id: current.id,
            label: patch.label.unwrap_or(current.label),
            host: patch.host.unwrap_or(current.host),
            port: patch.port.unwrap_or(current.port),
            username: patch.username.unwrap_or(current.username),
            notes: match patch.notes {
                None => current.notes,
                Some(v) => v,
            },
            created_at: current.created_at,
            last_connected_at: current.last_connected_at,
            sort_order: current.sort_order,
        };
        conn.execute(
            "UPDATE hosts SET label=?2, host=?3, port=?4, username=?5, notes=?6 WHERE id=?1",
            params![
                merged.id.to_string(), &merged.label, &merged.host, merged.port,
                &merged.username, &merged.notes,
            ],
        ).map_err(|e| Error::Protocol(format!("update host: {e}")))?;
        Ok(merged)
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM hosts WHERE id = ?1", params![id.to_string()])
            .map_err(|e| Error::Protocol(format!("delete host: {e}")))?;
        Ok(())
    }

    pub async fn touch_last_connected(&self, id: Uuid) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE hosts SET last_connected_at = ?2 WHERE id = ?1",
            params![id.to_string(), now_ms()],
        ).map_err(|e| Error::Protocol(format!("touch last_connected: {e}")))?;
        Ok(())
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn row_to_record(row: &rusqlite::Row) -> rusqlite::Result<HostRecord> {
    let id_str: String = row.get(0)?;
    let id = Uuid::parse_str(&id_str)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;
    Ok(HostRecord {
        id,
        label: row.get(1)?,
        host: row.get(2)?,
        port: row.get::<_, i64>(3)? as u16,
        username: row.get(4)?,
        notes: row.get(5)?,
        created_at: row.get(6)?,
        last_connected_at: row.get(7)?,
        sort_order: row.get(8)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn temp_store() -> (HostStore, TempDir) {
        let tmp = TempDir::new().unwrap();
        let store = HostStore::open(tmp.path()).unwrap();
        (store, tmp)
    }

    #[tokio::test]
    async fn insert_and_list_roundtrip() {
        let (store, _tmp) = temp_store().await;
        let new = NewHost {
            label: "prod-1".into(), host: "10.0.0.1".into(),
            port: 22, username: "chen".into(), notes: None,
        };
        let inserted = store.insert(new).await.unwrap();
        assert_eq!(inserted.label, "prod-1");
        assert_eq!(inserted.port, 22);
        assert!(inserted.last_connected_at.is_none());
        assert_eq!(inserted.sort_order, inserted.created_at);

        let listed = store.list().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, inserted.id);
    }

    #[tokio::test]
    async fn update_merges_and_returns_new_record() {
        let (store, _tmp) = temp_store().await;
        let r = store.insert(NewHost {
            label: "old".into(), host: "h".into(), port: 22,
            username: "u".into(), notes: None,
        }).await.unwrap();

        let updated = store.update(r.id, HostUpdate {
            label: Some("new".into()),
            port: Some(2222),
            host: None, username: None, notes: None,
        }).await.unwrap();

        assert_eq!(updated.label, "new");
        assert_eq!(updated.port, 2222);
        assert_eq!(updated.host, "h");  // unchanged
        assert_eq!(updated.username, "u");  // unchanged
    }

    #[tokio::test]
    async fn delete_removes_and_is_idempotent() {
        let (store, _tmp) = temp_store().await;
        let r = store.insert(NewHost {
            label: "x".into(), host: "h".into(), port: 22,
            username: "u".into(), notes: None,
        }).await.unwrap();
        store.delete(r.id).await.unwrap();
        assert!(store.list().await.unwrap().is_empty());
        // idempotent: deleting again should not error
        store.delete(r.id).await.unwrap();
    }

    #[tokio::test]
    async fn touch_last_connected_updates_timestamp() {
        let (store, _tmp) = temp_store().await;
        let r = store.insert(NewHost {
            label: "x".into(), host: "h".into(), port: 22,
            username: "u".into(), notes: None,
        }).await.unwrap();
        assert!(r.last_connected_at.is_none());
        store.touch_last_connected(r.id).await.unwrap();
        let after = store.get(r.id).await.unwrap().unwrap();
        assert!(after.last_connected_at.is_some());
    }
}

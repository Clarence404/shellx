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
    pub auth_method: String,
    pub key_path: Option<String>,
    pub connection_mode: String, // "terminal_only" | "term_tunnels" | "tunnels_only"
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewHost {
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub notes: Option<String>,
    pub auth_method: String,        // "password" | "publickey"
    pub key_path: Option<String>,
    pub connection_mode: Option<String>, // None defaults to "terminal_only"
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct HostUpdate {
    pub label: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    #[serde(default, deserialize_with = "double_option_deserialize")]
    pub notes: Option<Option<String>>,  // None = leave unchanged; Some(None) = clear; Some(Some(s)) = set
    pub auth_method: Option<String>,                        // None = leave unchanged
    #[serde(default, deserialize_with = "double_option_deserialize")]
    pub key_path: Option<Option<String>>,                  // triple-state: absent/null/string
    pub connection_mode: Option<String>,
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
        // Idempotent migration: add auth columns if not present (upgrades pre-v0.8 databases).
        let has_auth: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('hosts') WHERE name='auth_method'")
            .map_err(|e| Error::Protocol(format!("prepare migration check: {e}")))?
            .exists([])
            .map_err(|e| Error::Protocol(format!("migration check: {e}")))?;
        if !has_auth {
            conn.execute_batch(
                "ALTER TABLE hosts ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password';
                 ALTER TABLE hosts ADD COLUMN key_path TEXT;",
            )
            .map_err(|e| Error::Protocol(format!("apply auth migration: {e}")))?;
        }
        // Idempotent migration: add connection_mode column if not present (upgrades pre-v0.9 databases).
        let has_mode: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('hosts') WHERE name='connection_mode'")
            .map_err(|e| Error::Protocol(format!("prepare migration check: {e}")))?
            .exists([])
            .map_err(|e| Error::Protocol(format!("migration check: {e}")))?;
        if !has_mode {
            conn.execute_batch(
                // Default is terminal_only so existing hosts keep v0.8 behaviour unchanged.
                "ALTER TABLE hosts ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'terminal_only';",
            )
            .map_err(|e| Error::Protocol(format!("migration: {e}")))?;
        }
        // Idempotent migration: add bind_all column to tunnels if not present (upgrades pre-v0.9 databases).
        let has_bind_all: bool = conn
            .prepare("SELECT 1 FROM pragma_table_info('tunnels') WHERE name='bind_all'")
            .map_err(|e| Error::Protocol(format!("prepare migration check: {e}")))?
            .exists([])
            .map_err(|e| Error::Protocol(format!("migration check: {e}")))?;
        if !has_bind_all {
            conn.execute(
                "ALTER TABLE tunnels ADD COLUMN bind_all INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(|e| Error::Protocol(format!("apply bind_all migration: {e}")))?;
        }
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }

    pub async fn list(&self) -> Result<Vec<HostRecord>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, label, host, port, username, notes, created_at, last_connected_at, sort_order, auth_method, key_path, connection_mode \
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
            "SELECT id, label, host, port, username, notes, created_at, last_connected_at, sort_order, auth_method, key_path, connection_mode \
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
            auth_method: new.auth_method,
            key_path: new.key_path,
            connection_mode: new.connection_mode.unwrap_or_else(|| "terminal_only".to_string()),
        };
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO hosts (id, label, host, port, username, notes, created_at, last_connected_at, sort_order, auth_method, key_path, connection_mode) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                record.id.to_string(), &record.label, &record.host, record.port,
                &record.username, &record.notes, record.created_at,
                record.last_connected_at, record.sort_order,
                &record.auth_method, &record.key_path, &record.connection_mode,
            ],
        ).map_err(|e| Error::Protocol(format!("insert host: {e}")))?;
        Ok(record)
    }

    pub async fn update(&self, id: Uuid, patch: HostUpdate) -> Result<HostRecord> {
        let conn = self.conn.lock().await;
        // Read current
        let current: HostRecord = {
            let mut stmt = conn.prepare(
                "SELECT id, label, host, port, username, notes, created_at, last_connected_at, sort_order, auth_method, key_path, connection_mode \
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
            auth_method: patch.auth_method.unwrap_or(current.auth_method),
            key_path: match patch.key_path {
                None => current.key_path,
                Some(v) => v,
            },
            connection_mode: patch.connection_mode.unwrap_or(current.connection_mode),
        };
        conn.execute(
            "UPDATE hosts SET label=?2, host=?3, port=?4, username=?5, notes=?6, auth_method=?7, key_path=?8, connection_mode=?9 WHERE id=?1",
            params![
                merged.id.to_string(), &merged.label, &merged.host, merged.port,
                &merged.username, &merged.notes, &merged.auth_method, &merged.key_path,
                &merged.connection_mode,
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

    /// Return a clone of the underlying connection Arc so other stores (e.g. TunnelStore)
    /// can share the same SQLite connection without opening a second file handle.
    pub fn conn_arc(&self) -> Arc<Mutex<Connection>> {
        self.conn.clone()
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
        auth_method: row.get(9)?,
        key_path: row.get(10)?,
        connection_mode: row.get::<_, Option<String>>(11)?.unwrap_or_else(|| "terminal_only".to_string()),
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
            auth_method: "password".into(), key_path: None,
            connection_mode: None,
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
            auth_method: "password".into(), key_path: None,
            connection_mode: None,
        }).await.unwrap();

        let updated = store.update(r.id, HostUpdate {
            label: Some("new".into()),
            port: Some(2222),
            host: None, username: None, notes: None,
            auth_method: None, key_path: None,
            connection_mode: None,
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
            auth_method: "password".into(), key_path: None,
            connection_mode: None,
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
            auth_method: "password".into(), key_path: None,
            connection_mode: None,
        }).await.unwrap();
        assert!(r.last_connected_at.is_none());
        store.touch_last_connected(r.id).await.unwrap();
        let after = store.get(r.id).await.unwrap().unwrap();
        assert!(after.last_connected_at.is_some());
    }

    #[tokio::test]
    async fn insert_and_roundtrip_auth_fields() {
        let (store, _tmp) = temp_store().await;
        let rec = store.insert(NewHost {
            label: "k".into(), host: "h".into(), port: 22, username: "u".into(),
            notes: None,
            auth_method: "publickey".into(),
            key_path: Some("C:/Users/x/.ssh/id_ed25519".into()),
            connection_mode: None,
        }).await.unwrap();
        let got = store.get(rec.id).await.unwrap().unwrap();
        assert_eq!(got.auth_method, "publickey");
        assert_eq!(got.key_path.as_deref(), Some("C:/Users/x/.ssh/id_ed25519"));
    }

    #[tokio::test]
    async fn legacy_rows_default_to_password() {
        // Simulate a pre-v0.8 database (no auth columns), then open HostStore
        // which must migrate it. The existing row must read back as password/null.
        let td = TempDir::new().unwrap();
        {
            let conn = rusqlite::Connection::open(td.path().join("hosts.db")).unwrap();
            conn.execute_batch(
                "CREATE TABLE hosts (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, \
                 host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 22, username TEXT NOT NULL, \
                 notes TEXT, created_at INTEGER NOT NULL, last_connected_at INTEGER, \
                 sort_order INTEGER NOT NULL); \
                 CREATE INDEX idx_hosts_sort_order ON hosts(sort_order); \
                 INSERT INTO hosts VALUES ('00000000-0000-0000-0000-000000000001','a','h',22,'u',NULL,0,NULL,0);",
            ).unwrap();
        }
        let store = HostStore::open(td.path()).unwrap();
        let rows = store.list().await.unwrap();
        assert_eq!(rows[0].auth_method, "password");
        assert!(rows[0].key_path.is_none());
    }
}

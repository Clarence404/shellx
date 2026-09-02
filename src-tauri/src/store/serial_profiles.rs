//! Saved serial-port connections for the Serial view.
//!
//! A row is a port plus its line settings (baud / bits / parity / flow).
//! Deliberately its own table, same reasoning as `ftp_hosts`: a serial
//! profile is not an SSH host and shares nothing with one.

use crate::error::{Error, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS serial_profiles (
  id          TEXT PRIMARY KEY,
  label       TEXT    NOT NULL,
  port        TEXT    NOT NULL,
  baud        INTEGER NOT NULL DEFAULT 115200,
  data_bits   INTEGER NOT NULL DEFAULT 8,
  stop_bits   INTEGER NOT NULL DEFAULT 1,
  parity      TEXT    NOT NULL DEFAULT 'none',
  flow        TEXT    NOT NULL DEFAULT 'none',
  created_at  INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_serial_profiles_sort ON serial_profiles(sort_order);";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SerialProfile {
    pub id: Uuid,
    pub label: String,
    /// OS port name: "COM3" on Windows, "/dev/ttyUSB0" on Linux.
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
    pub created_at: i64,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewSerialProfile {
    pub label: String,
    pub port: String,
    pub baud: Option<u32>,
    pub data_bits: Option<u8>,
    pub stop_bits: Option<u8>,
    pub parity: Option<String>,
    pub flow: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SerialProfileUpdate {
    pub label: Option<String>,
    pub port: Option<String>,
    pub baud: Option<u32>,
    pub data_bits: Option<u8>,
    pub stop_bits: Option<u8>,
    pub parity: Option<String>,
    pub flow: Option<String>,
}

#[derive(Clone)]
pub struct SerialProfileStore {
    conn: Arc<Mutex<Connection>>,
}

impl SerialProfileStore {
    /// Shares the connection `HostStore` opened — one database file.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Result<Self> {
        {
            // try_lock: startup-only, and blocking_lock panics inside a runtime.
            let guard = conn
                .try_lock()
                .map_err(|_| Error::Protocol("serial_profiles: database busy at startup".into()))?;
            guard
                .execute_batch(SCHEMA)
                .map_err(|e| Error::Protocol(format!("serial_profiles schema: {e}")))?;
        }
        Ok(Self { conn })
    }

    pub async fn list(&self) -> Result<Vec<SerialProfile>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, label, port, baud, data_bits, stop_bits, parity, flow, \
                 created_at, sort_order FROM serial_profiles ORDER BY sort_order",
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        let rows = stmt
            .query_map([], row_to_profile)
            .map_err(|e| Error::Protocol(e.to_string()))?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Protocol(e.to_string()))?;
        Ok(rows)
    }

    pub async fn get(&self, id: Uuid) -> Result<Option<SerialProfile>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, label, port, baud, data_bits, stop_bits, parity, flow, \
                 created_at, sort_order FROM serial_profiles WHERE id=?1",
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        let mut rows = stmt
            .query_map(params![id.to_string()], row_to_profile)
            .map_err(|e| Error::Protocol(e.to_string()))?;
        match rows.next() {
            Some(r) => Ok(Some(r.map_err(|e| Error::Protocol(e.to_string()))?)),
            None => Ok(None),
        }
    }

    pub async fn insert(&self, new: NewSerialProfile) -> Result<SerialProfile> {
        let now = now_ms();
        let record = SerialProfile {
            id: Uuid::new_v4(),
            label: new.label,
            port: new.port,
            baud: new.baud.unwrap_or(115200),
            data_bits: new.data_bits.unwrap_or(8),
            stop_bits: new.stop_bits.unwrap_or(1),
            parity: new.parity.unwrap_or_else(|| "none".into()),
            flow: new.flow.unwrap_or_else(|| "none".into()),
            created_at: now,
            sort_order: now,
        };
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO serial_profiles (id, label, port, baud, data_bits, stop_bits, \
             parity, flow, created_at, sort_order) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                record.id.to_string(), &record.label, &record.port, record.baud,
                record.data_bits, record.stop_bits, &record.parity, &record.flow,
                record.created_at, record.sort_order,
            ],
        )
        .map_err(|e| Error::Protocol(format!("insert serial profile: {e}")))?;
        Ok(record)
    }

    pub async fn update(&self, id: Uuid, patch: SerialProfileUpdate) -> Result<SerialProfile> {
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| Error::Protocol(format!("no serial profile {id}")))?;
        let merged = SerialProfile {
            label: patch.label.unwrap_or(existing.label),
            port: patch.port.unwrap_or(existing.port),
            baud: patch.baud.unwrap_or(existing.baud),
            data_bits: patch.data_bits.unwrap_or(existing.data_bits),
            stop_bits: patch.stop_bits.unwrap_or(existing.stop_bits),
            parity: patch.parity.unwrap_or(existing.parity),
            flow: patch.flow.unwrap_or(existing.flow),
            ..existing
        };
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE serial_profiles SET label=?2, port=?3, baud=?4, data_bits=?5, \
             stop_bits=?6, parity=?7, flow=?8 WHERE id=?1",
            params![
                merged.id.to_string(), &merged.label, &merged.port, merged.baud,
                merged.data_bits, merged.stop_bits, &merged.parity, &merged.flow,
            ],
        )
        .map_err(|e| Error::Protocol(format!("update serial profile: {e}")))?;
        Ok(merged)
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM serial_profiles WHERE id=?1", params![id.to_string()])
            .map_err(|e| Error::Protocol(format!("delete serial profile: {e}")))?;
        Ok(())
    }
}

fn row_to_profile(r: &rusqlite::Row) -> rusqlite::Result<SerialProfile> {
    let id: String = r.get(0)?;
    Ok(SerialProfile {
        id: Uuid::parse_str(&id).unwrap_or_default(),
        label: r.get(1)?,
        port: r.get(2)?,
        baud: r.get(3)?,
        data_bits: r.get(4)?,
        stop_bits: r.get(5)?,
        parity: r.get(6)?,
        flow: r.get(7)?,
        created_at: r.get(8)?,
        sort_order: r.get(9)?,
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

    fn store() -> SerialProfileStore {
        let conn = Connection::open_in_memory().unwrap();
        SerialProfileStore::new(Arc::new(Mutex::new(conn))).unwrap()
    }

    fn new_profile(label: &str) -> NewSerialProfile {
        NewSerialProfile {
            label: label.into(),
            port: "COM3".into(),
            baud: None,
            data_bits: None,
            stop_bits: None,
            parity: None,
            flow: None,
        }
    }

    #[tokio::test]
    async fn crud_round_trip() {
        let s = store();
        let created = s.insert(new_profile("plc")).await.unwrap();
        assert_eq!(created.baud, 115200);
        assert_eq!(created.data_bits, 8);
        assert_eq!(created.parity, "none");

        let listed = s.list().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0], created);

        let updated = s
            .update(created.id, SerialProfileUpdate {
                baud: Some(9600),
                parity: Some("even".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(updated.baud, 9600);
        assert_eq!(updated.parity, "even");
        assert_eq!(updated.port, "COM3");

        s.delete(created.id).await.unwrap();
        assert!(s.list().await.unwrap().is_empty());
    }
}

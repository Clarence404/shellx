use crate::error::{Error, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct TunnelRule {
    pub id: Uuid,
    pub host_id: Uuid,
    pub label: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub enabled: bool,
    pub bind_all: bool,
    pub sort_order: i32,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewTunnelRule {
    pub host_id: Uuid,
    pub label: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub enabled: Option<bool>,
    pub bind_all: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateTunnelRule {
    pub id: Uuid,
    pub host_id: Option<Uuid>,
    pub label: Option<String>,
    pub local_port: Option<u16>,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
    pub enabled: Option<bool>,
    pub bind_all: Option<bool>,
    pub sort_order: Option<i32>,
}

pub struct TunnelStore {
    conn: Arc<Mutex<Connection>>,
}

impl TunnelStore {
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    pub async fn list_for_host(&self, host_id: Uuid) -> Result<Vec<TunnelRule>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id,host_id,label,local_port,remote_host,remote_port,enabled,bind_all,sort_order,created_at \
                 FROM tunnels WHERE host_id=?1 ORDER BY sort_order,created_at",
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        let rows = stmt
            .query_map(params![host_id.to_string()], |row| {
                Ok(TunnelRule {
                    id: row
                        .get::<_, String>(0)?
                        .parse()
                        .map_err(|_| rusqlite::Error::InvalidQuery)?,
                    host_id: row
                        .get::<_, String>(1)?
                        .parse()
                        .map_err(|_| rusqlite::Error::InvalidQuery)?,
                    label: row.get(2)?,
                    local_port: row.get::<_, i64>(3)? as u16,
                    remote_host: row.get(4)?,
                    remote_port: row.get::<_, i64>(5)? as u16,
                    enabled: row.get::<_, i64>(6)? != 0,
                    bind_all: row.get::<_, i64>(7)? != 0,
                    sort_order: row.get::<_, i64>(8)? as i32,
                    created_at: row.get(9)?,
                })
            })
            .map_err(|e| Error::Protocol(e.to_string()))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| Error::Protocol(e.to_string()))
    }

    pub async fn insert(&self, r: NewTunnelRule) -> Result<TunnelRule> {
        let id = Uuid::new_v4();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let enabled = r.enabled.unwrap_or(true);
        let bind_all = r.bind_all.unwrap_or(false);
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO tunnels (id,host_id,label,local_port,remote_host,remote_port,enabled,bind_all,sort_order,created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9)",
            params![
                id.to_string(),
                r.host_id.to_string(),
                r.label,
                r.local_port as i64,
                r.remote_host,
                r.remote_port as i64,
                enabled as i64,
                bind_all as i64,
                now,
            ],
        )
        .map_err(|e| Error::Protocol(e.to_string()))?;
        Ok(TunnelRule {
            id,
            host_id: r.host_id,
            label: r.label,
            local_port: r.local_port,
            remote_host: r.remote_host,
            remote_port: r.remote_port,
            enabled,
            bind_all,
            sort_order: 0,
            created_at: now,
        })
    }

    pub async fn update(&self, u: UpdateTunnelRule) -> Result<()> {
        let conn = self.conn.lock().await;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| Error::Protocol(e.to_string()))?;
        if let Some(v) = u.host_id {
            tx.execute(
                "UPDATE tunnels SET host_id=?1 WHERE id=?2",
                params![v.to_string(), u.id.to_string()],
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        }
        if let Some(v) = u.label {
            tx.execute(
                "UPDATE tunnels SET label=?1 WHERE id=?2",
                params![v, u.id.to_string()],
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        }
        if let Some(v) = u.local_port {
            tx.execute(
                "UPDATE tunnels SET local_port=?1 WHERE id=?2",
                params![v as i64, u.id.to_string()],
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        }
        if let Some(v) = u.remote_host {
            tx.execute(
                "UPDATE tunnels SET remote_host=?1 WHERE id=?2",
                params![v, u.id.to_string()],
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        }
        if let Some(v) = u.remote_port {
            tx.execute(
                "UPDATE tunnels SET remote_port=?1 WHERE id=?2",
                params![v as i64, u.id.to_string()],
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        }
        if let Some(v) = u.enabled {
            tx.execute(
                "UPDATE tunnels SET enabled=?1 WHERE id=?2",
                params![v as i64, u.id.to_string()],
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        }
        if let Some(v) = u.bind_all {
            tx.execute(
                "UPDATE tunnels SET bind_all=?1 WHERE id=?2",
                params![v as i64, u.id.to_string()],
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        }
        if let Some(v) = u.sort_order {
            tx.execute(
                "UPDATE tunnels SET sort_order=?1 WHERE id=?2",
                params![v as i64, u.id.to_string()],
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        }
        tx.commit().map_err(|e| Error::Protocol(e.to_string()))?;
        Ok(())
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM tunnels WHERE id=?1",
            params![id.to_string()],
        )
        .map_err(|e| Error::Protocol(e.to_string()))?;
        Ok(())
    }

    /// Assigns contiguous sort_order values (0, 1, 2, …) to the given rules
    /// in the order supplied.  Only rules belonging to `host_id` are touched;
    /// any extra IDs in `rule_ids` that don't match are silently ignored.
    pub async fn reorder(&self, host_id: Uuid, rule_ids: &[Uuid]) -> Result<()> {
        let conn = self.conn.lock().await;
        let tx = conn
            .unchecked_transaction()
            .map_err(|e| Error::Protocol(e.to_string()))?;
        for (i, id) in rule_ids.iter().enumerate() {
            tx.execute(
                "UPDATE tunnels SET sort_order=?1 WHERE id=?2 AND host_id=?3",
                params![i as i64, id.to_string(), host_id.to_string()],
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        }
        tx.commit().map_err(|e| Error::Protocol(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn make_store() -> TunnelStore {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("schema.sql")).unwrap();
        TunnelStore::new(Arc::new(Mutex::new(conn)))
    }

    #[tokio::test]
    async fn insert_and_list() {
        let store = make_store();
        let host_id = Uuid::new_v4();
        let rule = store
            .insert(NewTunnelRule {
                host_id,
                label: "DB".into(),
                local_port: 15432,
                remote_host: "db.internal".into(),
                remote_port: 5432,
                enabled: None,
                bind_all: None,
            })
            .await
            .unwrap();
        assert_eq!(rule.local_port, 15432);
        assert!(rule.enabled);
        let list = store.list_for_host(host_id).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, rule.id);
        assert_eq!(list[0].host_id, host_id);
        assert_eq!(list[0].local_port, 15432);
        assert!(list[0].enabled);
    }

    #[tokio::test]
    async fn update_enabled() {
        let store = make_store();
        let host_id = Uuid::new_v4();
        let rule = store
            .insert(NewTunnelRule {
                host_id,
                label: "x".into(),
                local_port: 1234,
                remote_host: "h".into(),
                remote_port: 80,
                enabled: None,
                bind_all: None,
            })
            .await
            .unwrap();
        store
            .update(UpdateTunnelRule {
                id: rule.id,
                host_id: None,
                enabled: Some(false),
                label: None,
                local_port: None,
                remote_host: None,
                remote_port: None,
                bind_all: None,
                sort_order: None,
            })
            .await
            .unwrap();
        let list = store.list_for_host(host_id).await.unwrap();
        assert!(!list[0].enabled);
    }

    #[tokio::test]
    async fn delete() {
        let store = make_store();
        let host_id = Uuid::new_v4();
        let rule = store
            .insert(NewTunnelRule {
                host_id,
                label: "x".into(),
                local_port: 1234,
                remote_host: "h".into(),
                remote_port: 80,
                enabled: None,
                bind_all: None,
            })
            .await
            .unwrap();
        store.delete(rule.id).await.unwrap();
        assert!(store.list_for_host(host_id).await.unwrap().is_empty());
    }
}

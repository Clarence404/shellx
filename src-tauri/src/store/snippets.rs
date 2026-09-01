//! Saved command snippets — the user's own library of commands worth
//! not retyping. Global, not per host: the whole point is carrying the
//! same toolbox to whichever machine is on screen.

use crate::error::{Error, Result};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS snippets (
  id         TEXT PRIMARY KEY,
  name       TEXT    NOT NULL,
  command    TEXT    NOT NULL,
  auto_enter INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: Uuid,
    pub name: String,
    pub command: String,
    /// Whether picking this snippet also presses Enter. Off by default —
    /// a command the user reads before running is the safe default.
    pub auto_enter: bool,
    pub sort_order: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSnippet {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub auto_enter: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnippetUpdate {
    pub name: Option<String>,
    pub command: Option<String>,
    pub auto_enter: Option<bool>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn row_to_snippet(row: &Row) -> rusqlite::Result<Snippet> {
    Ok(Snippet {
        id: row
            .get::<_, String>(0)?
            .parse()
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        name: row.get(1)?,
        command: row.get(2)?,
        auto_enter: row.get::<_, i64>(3)? != 0,
        sort_order: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[derive(Clone)]
pub struct SnippetStore {
    conn: Arc<Mutex<Connection>>,
}

impl SnippetStore {
    /// Shares the connection `HostStore` opened — one database file,
    /// one migration point.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Result<Self> {
        {
            let guard = conn
                .try_lock()
                .map_err(|_| Error::Protocol("snippets: database busy at startup".into()))?;
            guard
                .execute_batch(SCHEMA)
                .map_err(|e| Error::Protocol(format!("snippets schema: {e}")))?;
        }
        Ok(Self { conn })
    }

    pub async fn list(&self) -> Result<Vec<Snippet>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, command, auto_enter, sort_order, created_at
                 FROM snippets ORDER BY sort_order, created_at",
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        let rows = stmt
            .query_map([], row_to_snippet)
            .map_err(|e| Error::Protocol(e.to_string()))?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Protocol(e.to_string()))?;
        Ok(rows)
    }

    pub async fn insert(&self, new: NewSnippet) -> Result<Snippet> {
        let conn = self.conn.lock().await;
        let next_order: i64 = conn
            .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM snippets", [], |r| r.get(0))
            .map_err(|e| Error::Protocol(e.to_string()))?;
        let snippet = Snippet {
            id: Uuid::new_v4(),
            name: new.name,
            command: new.command,
            auto_enter: new.auto_enter,
            sort_order: next_order,
            created_at: now_ms(),
        };
        conn.execute(
            "INSERT INTO snippets (id, name, command, auto_enter, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                snippet.id.to_string(), snippet.name, snippet.command,
                snippet.auto_enter as i64, snippet.sort_order, snippet.created_at,
            ],
        )
        .map_err(|e| Error::Protocol(format!("snippets insert: {e}")))?;
        Ok(snippet)
    }

    pub async fn update(&self, id: Uuid, up: SnippetUpdate) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE snippets SET
               name       = COALESCE(?2, name),
               command    = COALESCE(?3, command),
               auto_enter = COALESCE(?4, auto_enter)
             WHERE id = ?1",
            params![
                id.to_string(), up.name, up.command,
                up.auto_enter.map(|b| b as i64),
            ],
        )
        .map_err(|e| Error::Protocol(format!("snippets update: {e}")))?;
        Ok(())
    }

    pub async fn delete(&self, id: Uuid) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM snippets WHERE id = ?1", params![id.to_string()])
            .map_err(|e| Error::Protocol(format!("snippets delete: {e}")))?;
        Ok(())
    }

    /// True when an identical snippet is already saved — the import
    /// path's duplicate check.
    pub async fn exists(&self, name: &str, command: &str) -> Result<bool> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare("SELECT 1 FROM snippets WHERE name = ?1 AND command = ?2")
            .map_err(|e| Error::Protocol(e.to_string()))?;
        stmt.exists(params![name, command])
            .map_err(|e| Error::Protocol(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> SnippetStore {
        let conn = Connection::open_in_memory().unwrap();
        SnippetStore::new(Arc::new(Mutex::new(conn))).unwrap()
    }

    #[tokio::test]
    async fn insert_lists_in_order_and_roundtrips() {
        let s = store();
        let a = s.insert(NewSnippet { name: "查磁盘".into(), command: "df -h".into(), auto_enter: false }).await.unwrap();
        let b = s.insert(NewSnippet { name: "看日志".into(), command: "tail -f x.log".into(), auto_enter: true }).await.unwrap();
        let got = s.list().await.unwrap();
        assert_eq!(got, vec![a, b.clone()]);
        assert!(got[1].auto_enter);
    }

    #[tokio::test]
    async fn update_merges_only_given_fields() {
        let s = store();
        let a = s.insert(NewSnippet { name: "n".into(), command: "c".into(), auto_enter: false }).await.unwrap();
        s.update(a.id, SnippetUpdate { name: None, command: Some("c2".into()), auto_enter: Some(true) }).await.unwrap();
        let got = &s.list().await.unwrap()[0];
        assert_eq!(got.name, "n");
        assert_eq!(got.command, "c2");
        assert!(got.auto_enter);
    }

    #[tokio::test]
    async fn delete_removes_and_exists_answers() {
        let s = store();
        let a = s.insert(NewSnippet { name: "n".into(), command: "c".into(), auto_enter: false }).await.unwrap();
        assert!(s.exists("n", "c").await.unwrap());
        s.delete(a.id).await.unwrap();
        assert!(!s.exists("n", "c").await.unwrap());
        assert!(s.list().await.unwrap().is_empty());
    }
}

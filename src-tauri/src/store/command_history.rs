//! Commands the user has run, for the terminal's inline suggestions.
//!
//! One row per (host, command). The terminal is a byte pipe — the shell
//! runs remotely — so what lands here is the frontend's shadow of the
//! input line, recorded at Enter. That makes this a best-effort record
//! for COMPLETION, not an audit log: lines the shadow lost track of
//! (tab-completed, arrow-edited) simply never arrive.

use crate::error::{Error, Result};
use rusqlite::{params, Connection};
use std::sync::Arc;
use tokio::sync::Mutex;

const SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS command_history (
  host_key     TEXT    NOT NULL,
  command      TEXT    NOT NULL,
  uses         INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (host_key, command)
);
CREATE INDEX IF NOT EXISTS idx_cmd_history_cmd ON command_history(command);";

/// Substrings that mark a line as too hot to store. The list is short on
/// purpose: it has to catch the obvious ways a secret rides on a command
/// line without turning into a grep of everything.
const SENSITIVE: &[&str] = &[
    "password", "passwd", "sshpass", "secret", "token=", "api_key", "apikey",
    "PRIVATE KEY",
];

/// bash convention: a leading space means "keep this out of history".
fn too_sensitive(command: &str) -> bool {
    if command.starts_with(' ') {
        return true;
    }
    let lower = command.to_lowercase();
    SENSITIVE.iter().any(|s| lower.contains(&s.to_lowercase()))
}

#[derive(Clone)]
pub struct CommandHistoryStore {
    conn: Arc<Mutex<Connection>>,
}

impl CommandHistoryStore {
    /// Shares the connection `HostStore` opened, the way the other
    /// stores do — one database file, one migration point.
    pub fn new(conn: Arc<Mutex<Connection>>) -> Result<Self> {
        {
            let guard = conn
                .try_lock()
                .map_err(|_| Error::Protocol("command_history: database busy at startup".into()))?;
            guard
                .execute_batch(SCHEMA)
                .map_err(|e| Error::Protocol(format!("command_history schema: {e}")))?;
        }
        Ok(Self { conn })
    }

    /// Records one executed command. Trims, drops the trivial and the
    /// sensitive, upserts the rest.
    pub async fn record(&self, host_key: &str, command: &str) -> Result<()> {
        let command = command.trim_end();
        if command.trim().len() < 2 || too_sensitive(command) {
            return Ok(());
        }
        let now = chrono::Utc::now().timestamp_millis();
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO command_history (host_key, command, uses, last_used_at)
             VALUES (?1, ?2, 1, ?3)
             ON CONFLICT(host_key, command)
             DO UPDATE SET uses = uses + 1, last_used_at = ?3",
            params![host_key, command, now],
        )
        .map_err(|e| Error::Protocol(format!("command_history record: {e}")))?;
        Ok(())
    }

    /// Commands starting with `prefix`, best first: this host's own
    /// history outranks other hosts', then use count, then recency.
    pub async fn suggest(&self, host_key: &str, prefix: &str, limit: u32) -> Result<Vec<String>> {
        if prefix.trim().is_empty() {
            return Ok(Vec::new());
        }
        // LIKE has its own wildcards; a literal % or _ in the prefix must
        // stay literal.
        let escaped = prefix.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let pattern = format!("{escaped}%");
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT command,
                        MAX(CASE WHEN host_key = ?1 THEN 1 ELSE 0 END) AS same_host,
                        SUM(uses) AS uses,
                        MAX(last_used_at) AS last_used
                 FROM command_history
                 WHERE command LIKE ?2 ESCAPE '\\' AND command <> ?3
                 GROUP BY command
                 ORDER BY same_host DESC, uses DESC, last_used DESC
                 LIMIT ?4",
            )
            .map_err(|e| Error::Protocol(e.to_string()))?;
        let rows = stmt
            .query_map(params![host_key, pattern, prefix, limit], |row| row.get::<_, String>(0))
            .map_err(|e| Error::Protocol(e.to_string()))?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| Error::Protocol(e.to_string()))?;
        Ok(rows)
    }

    /// Forgets everything — the Settings escape hatch.
    pub async fn clear(&self) -> Result<usize> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM command_history", [])
            .map_err(|e| Error::Protocol(format!("command_history clear: {e}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> CommandHistoryStore {
        let conn = Connection::open_in_memory().unwrap();
        CommandHistoryStore::new(Arc::new(Mutex::new(conn))).unwrap()
    }

    #[tokio::test]
    async fn suggests_by_prefix_with_own_host_first() {
        let s = store();
        s.record("other", "git status").await.unwrap();
        s.record("other", "git status").await.unwrap();
        s.record("mine", "git stash").await.unwrap();

        let got = s.suggest("mine", "git st", 5).await.unwrap();
        // The other host's command is used twice, but this host's own
        // history wins the tie for the top slot.
        assert_eq!(got, vec!["git stash".to_string(), "git status".to_string()]);
    }

    #[tokio::test]
    async fn an_exact_match_is_not_a_suggestion() {
        let s = store();
        s.record("h", "ls -la").await.unwrap();
        let got = s.suggest("h", "ls -la", 5).await.unwrap();
        assert!(got.is_empty());
    }

    #[tokio::test]
    async fn sensitive_lines_and_leading_space_never_land() {
        let s = store();
        s.record("h", "mysql -u root --password=hunter2").await.unwrap();
        s.record("h", " export AWS_KEY=abc").await.unwrap();
        s.record("h", "x").await.unwrap(); // too short
        let got = s.suggest("h", "m", 5).await.unwrap();
        assert!(got.is_empty());
        let got = s.suggest("h", "e", 5).await.unwrap();
        assert!(got.is_empty());
    }

    #[tokio::test]
    async fn like_wildcards_in_the_prefix_stay_literal() {
        let s = store();
        s.record("h", "grep 100% done.log").await.unwrap();
        s.record("h", "grep 1000 done.log").await.unwrap();
        let got = s.suggest("h", "grep 100%", 5).await.unwrap();
        assert_eq!(got, vec!["grep 100% done.log".to_string()]);
    }

    #[tokio::test]
    async fn repeated_use_floats_a_command_up() {
        let s = store();
        s.record("h", "docker ps -a").await.unwrap();
        s.record("h", "docker ps").await.unwrap();
        s.record("h", "docker ps").await.unwrap();
        let got = s.suggest("h", "docker", 5).await.unwrap();
        assert_eq!(got[0], "docker ps");
    }
}

//! Owns live connections keyed by UUID; drives byte pumping between the
//! underlying shell channel and subscribers.
//!
//! Note: v0.3 uses the `Connection` trait so a single connection can host
//! both a shell channel and an SFTP subsystem. The v0.2 "SessionInfo" is
//! now `ConnectionInfo` — same UUID identity, richer state.

use serde::Serialize;

pub mod manager;

pub type ConnectionId = uuid::Uuid;
/// Backwards-compat alias while callers migrate.
pub type SessionId = ConnectionId;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionKind {
    Ssh,
}
/// Backwards-compat alias.
pub type SessionKind = ConnectionKind;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Active,
    Closed,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionInfo {
    pub id: ConnectionId,
    pub label: String,
    pub kind: ConnectionKind,
    pub host_id: Option<uuid::Uuid>,
    pub state: ConnectionState,
}
/// Backwards-compat alias.
pub type SessionInfo = ConnectionInfo;

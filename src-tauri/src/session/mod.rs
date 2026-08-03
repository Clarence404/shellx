use serde::Serialize;

pub mod manager;

pub type SessionId = uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionKind {
    Ssh,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub id: SessionId,
    pub label: String,
    pub kind: SessionKind,
}

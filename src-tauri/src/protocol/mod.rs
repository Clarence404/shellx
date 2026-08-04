use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub mod sftp_types;
pub mod ssh;

use crate::error::Result;
pub use ssh::{ShellHandle, SftpHandle, SshConnection, SshProtocol};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    pub username: String,
    pub method: AuthMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AuthMethod {
    Password(String),
}

/// A Connection is one SSH connection to a host, capable of hosting multiple
/// activities (shell channel + SFTP subsystem) concurrently.
#[async_trait]
pub trait Connection: Send {
    async fn open_shell(&mut self) -> Result<ShellHandle>;
    async fn open_sftp(&mut self) -> Result<SftpHandle>;
    async fn disconnect(&mut self) -> Result<()>;
}

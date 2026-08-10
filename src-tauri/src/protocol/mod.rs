use async_trait::async_trait;
use russh::keys::PublicKey;
use serde::{Deserialize, Serialize};

pub mod sftp_types;
pub mod ssh;

use crate::error::Result;
pub use ssh::{RusshHandle, ShellHandle, SftpHandle, SshConnection, SshProtocol};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    pub username: String,
    pub method: AuthMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AuthMethod {
    Password(String),
    Key { path: String, passphrase: Option<String> },
}

/// A Connection is one SSH connection to a host, capable of hosting multiple
/// activities (shell channel + SFTP subsystem) concurrently.
#[async_trait]
pub trait Connection: Send {
    async fn open_shell(&mut self) -> Result<ShellHandle>;
    async fn open_sftp(&mut self) -> Result<SftpHandle>;
    async fn disconnect(&mut self) -> Result<()>;
}

/// Called once per connect handshake to approve or reject the server's public
/// key. Implementations may consult known_hosts, prompt the user, or
/// unconditionally accept/reject.
#[async_trait]
pub trait HostKeyPolicy: Send + Sync {
    async fn verify(&self, host: &str, port: u16, key: &PublicKey) -> bool;
}

/// Policy that accepts every server key without checking. Used in the session
/// manager's tests (where the in-process echo server has no known_hosts
/// entry) and as a fallback when no real policy is wired up.
pub struct AcceptAllPolicy;

#[async_trait]
impl HostKeyPolicy for AcceptAllPolicy {
    async fn verify(&self, _: &str, _: u16, _: &PublicKey) -> bool {
        true
    }
}

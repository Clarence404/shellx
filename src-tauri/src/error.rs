use serde::{Serialize, Serializer};
use std::io;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("auth: {0}")]
    Auth(String),
    #[error("protocol: {0}")]
    Protocol(String),
    #[error("timeout")]
    Timeout,
    #[error("closed")]
    Closed,
    #[error("passphrase-needed")]
    PassphraseNeeded,
    #[error("key-rejected: {0}")]
    KeyRejected(String),
    #[error("hostkey-declined")]
    HostKeyDeclined,
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

use crate::error::Result;
use async_trait::async_trait;
use serde::Serialize;
use tokio::io::{AsyncRead, AsyncWrite};

pub mod tcp;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportKind {
    Tcp,
    Serial,
    UsbCdc,
    Ws,
}

#[async_trait]
pub trait Transport: AsyncRead + AsyncWrite + Send + Unpin {
    fn kind(&self) -> TransportKind;
    async fn close(&mut self) -> Result<()>;
}

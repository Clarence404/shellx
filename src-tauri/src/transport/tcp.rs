use crate::error::{Error, Result};
use crate::transport::{Transport, TransportKind};
use async_trait::async_trait;
use std::pin::Pin;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::net::TcpStream;
use tokio::time::timeout;

pub struct TcpTransport {
    inner: TcpStream,
}

impl TcpTransport {
    pub async fn connect(host: &str, port: u16, dial_timeout: Duration) -> Result<Self> {
        let addr = format!("{host}:{port}");
        let stream = timeout(dial_timeout, TcpStream::connect(&addr))
            .await
            .map_err(|_| Error::Timeout)??;
        stream.set_nodelay(true)?;
        Ok(Self { inner: stream })
    }
}

impl AsyncRead for TcpTransport {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>)
        -> Poll<std::io::Result<()>>
    { Pin::new(&mut self.inner).poll_read(cx, buf) }
}

impl AsyncWrite for TcpTransport {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8])
        -> Poll<std::io::Result<usize>>
    { Pin::new(&mut self.inner).poll_write(cx, buf) }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>)
        -> Poll<std::io::Result<()>>
    { Pin::new(&mut self.inner).poll_flush(cx) }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>)
        -> Poll<std::io::Result<()>>
    { Pin::new(&mut self.inner).poll_shutdown(cx) }
}

#[async_trait]
impl Transport for TcpTransport {
    fn kind(&self) -> TransportKind { TransportKind::Tcp }
    async fn close(&mut self) -> Result<()> {
        use tokio::io::AsyncWriteExt;
        self.inner.shutdown().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn tcp_transport_roundtrips_bytes() {
        // Start a tiny echo server on an OS-assigned port.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 5];
            sock.read_exact(&mut buf).await.unwrap();
            sock.write_all(&buf).await.unwrap();
        });

        let mut t = TcpTransport::connect(&addr.ip().to_string(), addr.port(), Duration::from_secs(2))
            .await.unwrap();
        t.write_all(b"hello").await.unwrap();
        let mut resp = [0u8; 5];
        t.read_exact(&mut resp).await.unwrap();
        assert_eq!(&resp, b"hello");
        assert!(matches!(t.kind(), crate::transport::TransportKind::Tcp));
        t.close().await.unwrap();
    }
}

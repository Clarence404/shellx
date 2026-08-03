use crate::error::{Error, Result};
use crate::protocol::{AuthConfig, AuthMethod};
use russh::client::{self, Handle};
use russh::keys::PublicKey;
use russh::{Channel, ChannelMsg};
use std::sync::Arc;

pub struct SshProtocol;

pub struct SshSession {
    handle: Handle<ClientHandler>,
    channel: Channel<client::Msg>,
}

impl SshProtocol {
    pub async fn connect(host: &str, port: u16, auth: AuthConfig) -> Result<SshSession> {
        let config = Arc::new(client::Config::default());
        let handler = ClientHandler;
        let mut handle = client::connect(config, (host, port), handler)
            .await
            .map_err(|e| Error::Protocol(format!("connect: {e}")))?;
        let authed = match auth.method {
            AuthMethod::Password(pw) => handle
                .authenticate_password(auth.username, pw)
                .await
                .map_err(|e| Error::Auth(format!("password: {e}")))?,
        };
        if !authed.success() {
            return Err(Error::Auth("rejected".into()));
        }
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| Error::Protocol(format!("open session: {e}")))?;
        channel
            .request_pty(true, "xterm-256color", 80, 24, 0, 0, &[])
            .await
            .map_err(|e| Error::Protocol(format!("pty: {e}")))?;
        channel
            .request_shell(true)
            .await
            .map_err(|e| Error::Protocol(format!("shell: {e}")))?;
        Ok(SshSession { handle, channel })
    }
}

impl SshSession {
    pub async fn write_input(&mut self, data: &[u8]) -> Result<()> {
        self.channel
            .data(data)
            .await
            .map_err(|e| Error::Protocol(format!("write: {e}")))
    }

    pub async fn read_output(&mut self, buf: &mut Vec<u8>) -> Result<usize> {
        while let Some(msg) = self.channel.wait().await {
            match msg {
                ChannelMsg::Data { data } => {
                    buf.extend_from_slice(&data);
                    return Ok(data.len());
                }
                ChannelMsg::ExtendedData { data, .. } => {
                    buf.extend_from_slice(&data);
                    return Ok(data.len());
                }
                ChannelMsg::Eof | ChannelMsg::Close => return Ok(0),
                _ => continue,
            }
        }
        Ok(0)
    }

    pub async fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
        self.channel
            .window_change(cols as u32, rows as u32, 0, 0)
            .await
            .map_err(|e| Error::Protocol(format!("resize: {e}")))
    }

    pub async fn close(&mut self) -> Result<()> {
        let _ = self.channel.close().await;
        let _ = self
            .handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;
        Ok(())
    }
}

struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_key: &PublicKey,
    ) -> std::result::Result<bool, Self::Error> {
        // v0.1: trust on first use, no verification. v0.2 will add known-hosts.
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::server::{self as srv, Auth, Server as _, Session as SrvSession};
    use russh::{ChannelId, MethodKind, MethodSet};
    use std::time::Duration;

    struct TestServer;
    impl srv::Server for TestServer {
        type Handler = TestHandler;
        fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> TestHandler {
            TestHandler
        }
    }

    struct TestHandler;
    impl srv::Handler for TestHandler {
        type Error = russh::Error;

        async fn auth_password(
            &mut self,
            user: &str,
            pw: &str,
        ) -> std::result::Result<Auth, Self::Error> {
            if user == "chen" && pw == "pw" {
                Ok(Auth::Accept)
            } else {
                Ok(Auth::Reject {
                    proceed_with_methods: None,
                    partial_success: false,
                })
            }
        }

        async fn channel_open_session(
            &mut self,
            _channel: russh::Channel<srv::Msg>,
            reply: srv::ChannelOpenHandle,
            _session: &mut SrvSession,
        ) -> std::result::Result<(), Self::Error> {
            reply.accept().await;
            Ok(())
        }

        async fn data(
            &mut self,
            chan: ChannelId,
            data: &[u8],
            session: &mut SrvSession,
        ) -> std::result::Result<(), Self::Error> {
            // Echo the bytes back to the client's stdout.
            session.data(chan, data.to_vec())?;
            Ok(())
        }
    }

    #[tokio::test]
    async fn ssh_password_auth_and_echo() {
        let cfg = Arc::new(srv::Config {
            keys: vec![russh::keys::PrivateKey::random(
                &mut rand::rng(),
                russh::keys::Algorithm::Ed25519,
            )
            .unwrap()],
            methods: {
                let mut m = MethodSet::empty();
                m.push(MethodKind::Password);
                m
            },
            inactivity_timeout: Some(Duration::from_secs(3)),
            ..Default::default()
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut sh = TestServer;
        tokio::spawn(async move {
            let _ = sh.run_on_socket(cfg, &listener).await;
        });

        let auth = AuthConfig {
            username: "chen".into(),
            method: AuthMethod::Password("pw".into()),
        };
        let mut sess = SshProtocol::connect("127.0.0.1", port, auth).await.unwrap();
        sess.write_input(b"hello").await.unwrap();
        let mut buf = Vec::new();
        let n = sess.read_output(&mut buf).await.unwrap();
        assert!(n >= 5);
        assert!(buf.starts_with(b"hello"));
        sess.close().await.unwrap();
    }
}

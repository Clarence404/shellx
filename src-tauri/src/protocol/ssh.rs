use crate::error::{Error, Result};
use crate::protocol::{AuthConfig, AuthMethod, Connection};
use async_trait::async_trait;
use russh::client::{self, Handle};
use russh::keys::PublicKey;
use russh::{Channel, ChannelMsg};
use std::sync::Arc;
use std::time::Duration;

pub struct SshProtocol;

/// One SSH connection to a host. Authentication happens during `connect`;
/// no channel is opened yet — callers open a shell (and, from Task 2
/// onward, an SFTP subsystem) explicitly via the `Connection` trait.
///
/// `russh::client::Handle` is not `Clone` (it owns an `UnboundedReceiver`
/// and the driving task's `JoinHandle`), but every method we need from it
/// after the initial authenticate step — `channel_open_session`,
/// `disconnect` — takes `&self`. Wrapping it in an `Arc` lets both the
/// `SshConnection` and every `ShellHandle` it opens share the same
/// underlying handle without a `Mutex`.
pub struct SshConnection {
    handle: Arc<Handle<ClientHandler>>,
}

pub struct ShellHandle {
    handle: Arc<Handle<ClientHandler>>,
    channel: Channel<client::Msg>,
}

/// Empty stub — Task 2 fills in the SFTP subsystem handle.
pub struct SftpHandle;

/// Maximum time the initial SSH connect (TCP handshake + KEX) is allowed to take before
/// giving up. Windows' OS-level TCP timeout is 21–30s on an unresponsive host; we bound
/// it here so the user sees "Connecting failed" quickly on a typo'd address instead of
/// staring at a spinner for half a minute.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

impl SshProtocol {
    pub async fn connect(host: &str, port: u16, auth: AuthConfig) -> Result<SshConnection> {
        let config = Arc::new(client::Config::default());
        let handler = ClientHandler;
        let mut handle = tokio::time::timeout(
            CONNECT_TIMEOUT,
            client::connect(config, (host, port), handler),
        )
        .await
        .map_err(|_| Error::Timeout)?
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
        Ok(SshConnection {
            handle: Arc::new(handle),
        })
    }
}

#[async_trait]
impl Connection for SshConnection {
    async fn open_shell(&mut self) -> Result<ShellHandle> {
        let channel = self
            .handle
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
        Ok(ShellHandle {
            handle: self.handle.clone(),
            channel,
        })
    }

    async fn open_sftp(&mut self) -> Result<SftpHandle> {
        Err(Error::Protocol("sftp not implemented — Task 2".into()))
    }

    async fn disconnect(&mut self) -> Result<()> {
        self.handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await
            .map_err(|e| Error::Protocol(format!("disconnect: {e}")))
    }
}

impl ShellHandle {
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

// Shared russh-server test fixture. Promoted to `pub` (Task 11, still behind
// the `test-fixtures` feature) so out-of-crate integration tests can reach
// it; `session::manager`'s in-crate tests also use it.
#[cfg(any(test, feature = "test-fixtures"))]
pub mod testing {
    use russh::server::{self as srv, Auth, Server as _, Session as SrvSession};
    use russh::{ChannelId, MethodKind, MethodSet};
    use std::sync::Arc;
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

    /// Spins up an in-process SSH server (password auth "chen"/"pw", echoes
    /// whatever it receives back to the client) on an ephemeral port and
    /// returns that port plus the JoinHandle of the task serving it.
    pub async fn start_echo_ssh_server() -> (u16, tokio::task::JoinHandle<()>) {
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
        let handle = tokio::spawn(async move {
            let _ = sh.run_on_socket(cfg, &listener).await;
        });
        (port, handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ssh_password_auth_and_echo() {
        let (port, _handle) = testing::start_echo_ssh_server().await;

        let auth = AuthConfig {
            username: "chen".into(),
            method: AuthMethod::Password("pw".into()),
        };
        let mut conn = SshProtocol::connect("127.0.0.1", port, auth).await.unwrap();
        let mut shell = conn.open_shell().await.unwrap();
        shell.write_input(b"hello").await.unwrap();
        let mut buf = Vec::new();
        let n = shell.read_output(&mut buf).await.unwrap();
        assert!(n >= 5);
        assert!(buf.starts_with(b"hello"));
        shell.close().await.unwrap();
    }
}

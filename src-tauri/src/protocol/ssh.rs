use crate::error::{Error, Result};
use crate::protocol::sftp_types::{Entry, EntryKind};
use crate::protocol::{AuthConfig, AuthMethod, Connection, HostKeyPolicy};
use async_trait::async_trait;
use russh::client::{self, Handle};
use russh::keys::PublicKey;
use russh::{Channel, ChannelMsg};
use russh_sftp::client::SftpSession;
use std::sync::atomic::{AtomicBool, Ordering};
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

/// One SFTP subsystem opened on a session channel of an `SshConnection`.
pub struct SftpHandle {
    inner: SftpSession,
}

/// A cheaply-cloneable reference to the underlying russh connection handle.
/// Tunnel tasks clone this to open `channel_open_direct_tcpip` channels
/// without holding the `SshConnection` mutex.
pub type RusshHandle = Arc<Handle<ClientHandler>>;

impl SshConnection {
    pub fn handle_clone(&self) -> RusshHandle {
        Arc::clone(&self.handle)
    }

    pub async fn exec(&self, cmd: &str) -> Result<String> {
        exec_cmd(&self.handle, cmd).await
    }
}

/// Maximum time the initial SSH connect (TCP handshake + KEX) is allowed to take before
/// giving up. Windows' OS-level TCP timeout is 21–30s on an unresponsive host; we bound
/// it here so the user sees "Connecting failed" quickly on a typo'd address instead of
/// staring at a spinner for half a minute.
/// Fallback budget for callers with no settings at hand (tests). The real
/// value comes from `settings.advanced.connectTimeoutSecs`.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

enum AuthKind {
    Key,
    Password,
}

impl SshProtocol {
    pub async fn connect(
        host: &str,
        port: u16,
        auth: AuthConfig,
        policy: Arc<dyn HostKeyPolicy>,
        advanced: &crate::settings::AdvancedSettings,
    ) -> Result<SshConnection> {
        // keepalive_interval = None means "send no keepalives", which is
        // what a 0 in the Advanced panel asks for. keepalive_max is the
        // number of unanswered probes russh tolerates before it drops the
        // transport, so a dead link surfaces in interval × max seconds.
        let keepalive_interval = match advanced.keepalive_interval_secs {
            0 => None,
            secs => Some(Duration::from_secs(secs as u64)),
        };
        let config = Arc::new(client::Config {
            keepalive_interval,
            keepalive_max: advanced.keepalive_max as usize,
            ..client::Config::default()
        });
        let connect_timeout = if advanced.connect_timeout_secs == 0 {
            CONNECT_TIMEOUT
        } else {
            Duration::from_secs(advanced.connect_timeout_secs as u64)
        };
        let rejected = Arc::new(AtomicBool::new(false));
        let handler = ClientHandler {
            host: host.to_string(),
            port,
            policy,
            rejected: rejected.clone(),
        };
        let mut handle = tokio::time::timeout(
            connect_timeout,
            client::connect(config, (host, port), handler),
        )
        .await
        .map_err(|_| Error::Timeout)?
        .map_err(|e| {
            if rejected.load(Ordering::Relaxed) {
                Error::HostKeyDeclined
            } else {
                Error::Protocol(format!("connect: {e}"))
            }
        })?;
        let auth_kind = match &auth.method {
            AuthMethod::Key { .. } => AuthKind::Key,
            AuthMethod::Password(_) => AuthKind::Password,
        };
        let authed = match auth.method {
            AuthMethod::Password(pw) => handle
                .authenticate_password(auth.username, pw)
                .await
                .map_err(|e| Error::Auth(format!("password: {e}")))?,
            AuthMethod::Key { path, passphrase } => {
                let key = crate::keys::load(std::path::Path::new(&path), passphrase.as_deref())?;
                let key_arc = Arc::new(key);
                let best_hash = handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(|e| Error::Protocol(format!("rsa-hash query: {e}")))?
                    .flatten();
                handle
                    .authenticate_publickey(
                        auth.username,
                        russh::keys::PrivateKeyWithHashAlg::new(key_arc, best_hash),
                    )
                    .await
                    .map_err(|e| Error::Auth(format!("publickey: {e}")))?
            }
        };
        if !authed.success() {
            return Err(match auth_kind {
                AuthKind::Key => Error::KeyRejected("server rejected the key".into()),
                AuthKind::Password => Error::Auth("rejected".into()),
            });
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
        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| Error::Protocol(format!("open sftp channel: {e}")))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| Error::Protocol(format!("request sftp subsystem: {e}")))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| Error::Protocol(format!("sftp session: {e}")))?;
        Ok(SftpHandle { inner: sftp })
    }

    async fn disconnect(&mut self) -> Result<()> {
        self.handle
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await
            .map_err(|e| Error::Protocol(format!("disconnect: {e}")))
    }
}

/// Runs a one-shot exec command on the given SSH connection handle and
/// collects all stdout. Times out after 10 s to guard against a hung remote.
pub(crate) async fn exec_cmd(handle: &RusshHandle, cmd: &str) -> Result<String> {
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| Error::Protocol(format!("exec open session: {e}")))?;
    channel
        .exec(true, cmd.as_bytes())
        .await
        .map_err(|e| Error::Protocol(format!("exec request: {e}")))?;
    let collect = async {
        let mut buf: Vec<u8> = Vec::new();
        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => buf.extend_from_slice(&data),
                Some(ChannelMsg::ExtendedData { .. }) => {}
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                Some(ChannelMsg::ExitStatus { .. }) => {}
                _ => {}
            }
        }
        buf
    };
    match tokio::time::timeout(tokio::time::Duration::from_secs(10), collect).await {
        Ok(buf) => Ok(String::from_utf8_lossy(&buf).into_owned()),
        Err(_) => Err(Error::Protocol("exec_cmd timed out".into())),
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

fn entry_kind(file_type: russh_sftp::protocol::FileType) -> EntryKind {
    if file_type.is_dir() {
        EntryKind::Directory
    } else if file_type.is_symlink() {
        EntryKind::Symlink
    } else if file_type.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    }
}

fn entry_from_metadata(name: String, meta: &russh_sftp::client::fs::Metadata) -> Entry {
    Entry {
        name,
        kind: entry_kind(meta.file_type()),
        size: meta.size.unwrap_or(0),
        modified: meta.mtime.map(|t| t as i64 * 1000),
        permissions: meta.permissions.unwrap_or(0),
    }
}

impl SftpHandle {
    pub async fn list_dir(&self, path: &str) -> Result<Vec<Entry>> {
        let raw = self
            .inner
            .read_dir(path)
            .await
            .map_err(|e| Error::Protocol(format!("sftp read_dir: {e}")))?;
        Ok(raw
            .map(|d| entry_from_metadata(d.file_name(), &d.metadata()))
            .collect())
    }

    pub async fn stat(&self, path: &str) -> Result<Entry> {
        let meta = self
            .inner
            .metadata(path)
            .await
            .map_err(|e| Error::Protocol(format!("sftp stat: {e}")))?;
        let name = path.rsplit('/').next().unwrap_or(path).to_string();
        Ok(entry_from_metadata(name, &meta))
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<()> {
        self.inner
            .rename(from, to)
            .await
            .map_err(|e| Error::Protocol(format!("sftp rename: {e}")))
    }

    pub async fn remove_file(&self, path: &str) -> Result<()> {
        self.inner
            .remove_file(path)
            .await
            .map_err(|e| Error::Protocol(format!("sftp remove_file: {e}")))
    }

    pub async fn remove_dir(&self, path: &str) -> Result<()> {
        self.inner
            .remove_dir(path)
            .await
            .map_err(|e| Error::Protocol(format!("sftp remove_dir: {e}")))
    }

    pub async fn mkdir(&self, path: &str) -> Result<()> {
        self.inner
            .create_dir(path)
            .await
            .map_err(|e| Error::Protocol(format!("sftp mkdir: {e}")))
    }

    pub async fn realpath(&self, path: &str) -> Result<String> {
        self.inner
            .canonicalize(path)
            .await
            .map_err(|e| Error::Protocol(format!("sftp realpath: {e}")))
    }

    pub async fn open_read_stream(&self, path: &str) -> Result<russh_sftp::client::fs::File> {
        self.inner
            .open(path)
            .await
            .map_err(|e| Error::Protocol(format!("sftp open_read: {e}")))
    }

    pub async fn open_write_stream(&self, path: &str) -> Result<russh_sftp::client::fs::File> {
        self.inner
            .create(path)
            .await
            .map_err(|e| Error::Protocol(format!("sftp open_write: {e}")))
    }

    pub async fn close(&mut self) -> Result<()> {
        self.inner
            .close()
            .await
            .map_err(|e| Error::Protocol(format!("sftp close: {e}")))
    }
}

pub(crate) struct ClientHandler {
    host: String,
    port: u16,
    policy: Arc<dyn HostKeyPolicy>,
    /// Set to `true` when the policy rejects a key so the connect caller can
    /// distinguish a policy-driven refusal from a network or protocol error.
    rejected: Arc<AtomicBool>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_key: &PublicKey,
    ) -> std::result::Result<bool, Self::Error> {
        let accepted = self.policy.verify(&self.host, self.port, server_key).await;
        if !accepted {
            self.rejected.store(true, Ordering::Relaxed);
        }
        Ok(accepted)
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

        async fn auth_publickey(
            &mut self,
            _user: &str,
            _key: &russh::keys::ssh_key::PublicKey,
        ) -> std::result::Result<Auth, Self::Error> {
            Ok(Auth::Accept)
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
                m.push(MethodKind::PublicKey);
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

    // --- SFTP-capable fixture (Task 2) -------------------------------------
    //
    // Same password auth as the echo server above, but on `subsystem_request`
    // for "sftp" it hands the channel's stream off to `russh_sftp::server::run`
    // backed by `SftpBackend`, a minimal real-filesystem-backed handler rooted
    // at a caller-supplied directory (a `TempDir` in the integration test).

    use russh_sftp::protocol::{
        Attrs, Data, File as SftpFile, FileAttributes, Handle as SftpFileHandle, Name, OpenFlags,
        Status, StatusCode,
    };
    use std::collections::{HashMap, VecDeque};
    use std::path::PathBuf;
    use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

    fn ok_status(id: u32) -> Status {
        Status {
            id,
            status_code: StatusCode::Ok,
            error_message: "Ok".to_string(),
            language_tag: "en-US".to_string(),
        }
    }

    /// Minimal SFTP server backend that maps SFTP operations onto real
    /// filesystem calls rooted at `root`. Handles ("file descriptors" /
    /// "directory listings" in SFTP-speak) are tracked by an incrementing
    /// string id, same as a typical SFTP server implementation.
    struct SftpBackend {
        root: PathBuf,
        files: HashMap<String, tokio::fs::File>,
        dirs: HashMap<String, VecDeque<(String, FileAttributes)>>,
        next_handle: u64,
    }

    impl SftpBackend {
        fn new(root: PathBuf) -> Self {
            Self {
                root,
                files: HashMap::new(),
                dirs: HashMap::new(),
                next_handle: 0,
            }
        }

        /// Resolves a (possibly `.`/`./`-relative) SFTP path against `root`,
        /// confining every operation to the fixture's temp directory.
        fn resolve(&self, path: &str) -> PathBuf {
            let trimmed = path.trim_start_matches("./").trim_start_matches('/');
            if trimmed.is_empty() {
                self.root.clone()
            } else {
                self.root.join(trimmed)
            }
        }

        fn new_handle(&mut self) -> String {
            self.next_handle += 1;
            self.next_handle.to_string()
        }
    }

    impl russh_sftp::server::Handler for SftpBackend {
        type Error = StatusCode;

        fn unimplemented(&self) -> Self::Error {
            StatusCode::OpUnsupported
        }

        async fn open(
            &mut self,
            id: u32,
            filename: String,
            pflags: OpenFlags,
            _attrs: FileAttributes,
        ) -> std::result::Result<SftpFileHandle, Self::Error> {
            let path = self.resolve(&filename);
            let mut opts = tokio::fs::OpenOptions::new();
            if pflags.contains(OpenFlags::READ) {
                opts.read(true);
            }
            if pflags.contains(OpenFlags::WRITE) {
                opts.write(true);
            }
            if pflags.contains(OpenFlags::APPEND) {
                opts.append(true);
            }
            if pflags.contains(OpenFlags::CREATE) {
                if pflags.contains(OpenFlags::EXCLUDE) {
                    opts.create_new(true);
                } else {
                    opts.create(true);
                }
            }
            if pflags.contains(OpenFlags::TRUNCATE) {
                opts.truncate(true);
            }
            let file = opts.open(&path).await.map_err(|_| StatusCode::Failure)?;
            let handle = self.new_handle();
            self.files.insert(handle.clone(), file);
            Ok(SftpFileHandle { id, handle })
        }

        async fn close(
            &mut self,
            id: u32,
            handle: String,
        ) -> std::result::Result<Status, Self::Error> {
            self.files.remove(&handle);
            self.dirs.remove(&handle);
            Ok(ok_status(id))
        }

        async fn read(
            &mut self,
            id: u32,
            handle: String,
            offset: u64,
            len: u32,
        ) -> std::result::Result<Data, Self::Error> {
            let file = self.files.get_mut(&handle).ok_or(StatusCode::Failure)?;
            file.seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|_| StatusCode::Failure)?;
            let mut buf = vec![0u8; len as usize];
            let n = file.read(&mut buf).await.map_err(|_| StatusCode::Failure)?;
            if n == 0 {
                return Err(StatusCode::Eof);
            }
            buf.truncate(n);
            Ok(Data { id, data: buf })
        }

        async fn write(
            &mut self,
            id: u32,
            handle: String,
            offset: u64,
            data: Vec<u8>,
        ) -> std::result::Result<Status, Self::Error> {
            let file = self.files.get_mut(&handle).ok_or(StatusCode::Failure)?;
            file.seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|_| StatusCode::Failure)?;
            file.write_all(&data)
                .await
                .map_err(|_| StatusCode::Failure)?;
            Ok(ok_status(id))
        }

        async fn opendir(
            &mut self,
            id: u32,
            path: String,
        ) -> std::result::Result<SftpFileHandle, Self::Error> {
            let dir = self.resolve(&path);
            let mut entries = VecDeque::new();
            let mut rd = tokio::fs::read_dir(&dir)
                .await
                .map_err(|_| StatusCode::NoSuchFile)?;
            while let Ok(Some(entry)) = rd.next_entry().await {
                let name = entry.file_name().to_string_lossy().into_owned();
                let meta = entry
                    .metadata()
                    .await
                    .map_err(|_| StatusCode::Failure)?;
                entries.push_back((name, FileAttributes::from(&meta)));
            }
            let handle = self.new_handle();
            self.dirs.insert(handle.clone(), entries);
            Ok(SftpFileHandle { id, handle })
        }

        async fn readdir(
            &mut self,
            id: u32,
            handle: String,
        ) -> std::result::Result<Name, Self::Error> {
            let entries = self.dirs.get_mut(&handle).ok_or(StatusCode::Failure)?;
            if entries.is_empty() {
                return Err(StatusCode::Eof);
            }
            let files = entries
                .drain(..)
                .map(|(name, attrs)| SftpFile::new(name, attrs))
                .collect();
            Ok(Name { id, files })
        }

        async fn remove(
            &mut self,
            id: u32,
            filename: String,
        ) -> std::result::Result<Status, Self::Error> {
            let path = self.resolve(&filename);
            tokio::fs::remove_file(&path)
                .await
                .map_err(|_| StatusCode::Failure)?;
            Ok(ok_status(id))
        }

        async fn mkdir(
            &mut self,
            id: u32,
            path: String,
            _attrs: FileAttributes,
        ) -> std::result::Result<Status, Self::Error> {
            let full = self.resolve(&path);
            tokio::fs::create_dir(&full)
                .await
                .map_err(|_| StatusCode::Failure)?;
            Ok(ok_status(id))
        }

        async fn rmdir(
            &mut self,
            id: u32,
            path: String,
        ) -> std::result::Result<Status, Self::Error> {
            let full = self.resolve(&path);
            tokio::fs::remove_dir(&full)
                .await
                .map_err(|_| StatusCode::Failure)?;
            Ok(ok_status(id))
        }

        async fn stat(&mut self, id: u32, path: String) -> std::result::Result<Attrs, Self::Error> {
            let full = self.resolve(&path);
            let meta = tokio::fs::metadata(&full)
                .await
                .map_err(|_| StatusCode::NoSuchFile)?;
            Ok(Attrs {
                id,
                attrs: FileAttributes::from(&meta),
            })
        }

        async fn lstat(&mut self, id: u32, path: String) -> std::result::Result<Attrs, Self::Error> {
            let full = self.resolve(&path);
            let meta = tokio::fs::symlink_metadata(&full)
                .await
                .map_err(|_| StatusCode::NoSuchFile)?;
            Ok(Attrs {
                id,
                attrs: FileAttributes::from(&meta),
            })
        }

        async fn rename(
            &mut self,
            id: u32,
            oldpath: String,
            newpath: String,
        ) -> std::result::Result<Status, Self::Error> {
            let from = self.resolve(&oldpath);
            let to = self.resolve(&newpath);
            tokio::fs::rename(&from, &to)
                .await
                .map_err(|_| StatusCode::Failure)?;
            Ok(ok_status(id))
        }

        async fn realpath(&mut self, id: u32, path: String) -> std::result::Result<Name, Self::Error> {
            Ok(Name {
                id,
                files: vec![SftpFile::dummy(path)],
            })
        }
    }

    struct SftpTestServer {
        root: PathBuf,
    }
    impl srv::Server for SftpTestServer {
        type Handler = SftpTestHandler;
        fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> SftpTestHandler {
            SftpTestHandler {
                root: self.root.clone(),
                channels: HashMap::new(),
            }
        }
    }

    /// Per-connection handler: authenticates, stashes newly-opened session
    /// channels by id (needed because `subsystem_request` only gets a
    /// `ChannelId`, not the `Channel` itself), then on the "sftp" subsystem
    /// request hands the channel's stream to `russh_sftp::server::run`.
    struct SftpTestHandler {
        root: PathBuf,
        channels: HashMap<ChannelId, russh::Channel<srv::Msg>>,
    }

    impl srv::Handler for SftpTestHandler {
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

        async fn auth_publickey(
            &mut self,
            _user: &str,
            _key: &russh::keys::ssh_key::PublicKey,
        ) -> std::result::Result<Auth, Self::Error> {
            Ok(Auth::Accept)
        }

        async fn channel_open_session(
            &mut self,
            channel: russh::Channel<srv::Msg>,
            reply: srv::ChannelOpenHandle,
            _session: &mut SrvSession,
        ) -> std::result::Result<(), Self::Error> {
            self.channels.insert(channel.id(), channel);
            reply.accept().await;
            Ok(())
        }

        async fn subsystem_request(
            &mut self,
            channel_id: ChannelId,
            name: &str,
            session: &mut SrvSession,
        ) -> std::result::Result<(), Self::Error> {
            if name == "sftp" {
                if let Some(channel) = self.channels.remove(&channel_id) {
                    session.channel_success(channel_id)?;
                    let backend = SftpBackend::new(self.root.clone());
                    russh_sftp::server::run(channel.into_stream(), backend).await;
                } else {
                    session.channel_failure(channel_id)?;
                }
            } else {
                session.channel_failure(channel_id)?;
            }
            Ok(())
        }
    }

    /// Spins up an in-process SSH server (password auth "chen"/"pw") on an
    /// ephemeral port that serves an SFTP subsystem rooted at `root`, and
    /// returns that port plus the JoinHandle of the task serving it.
    pub async fn start_sftp_server(root: PathBuf) -> (u16, tokio::task::JoinHandle<()>) {
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
        let mut sh = SftpTestServer { root };
        let handle = tokio::spawn(async move {
            let _ = sh.run_on_socket(cfg, &listener).await;
        });
        (port, handle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::AcceptAllPolicy;

    // Same key used in src-tauri/src/keys/mod.rs — reused here to test key auth end-to-end.
    // Unencrypted ed25519 test key (generated with `ssh-keygen -t ed25519 -N "" -C plan-test`).
    // Checked-in as test data — never used on a real server.
    const ED25519_PLAIN: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\n\
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n\
QyNTUxOQAAACDts7+VHRlQca5kyUBPVu2tL5DCMT6bjKiL9X//FR4Y8wAAAJDCcHY8wnB2\n\
PAAAAAtzc2gtZWQyNTUxOQAAACDts7+VHRlQca5kyUBPVu2tL5DCMT6bjKiL9X//FR4Y8w\n\
AAAEDyaRnxSvCwZAN1uWo9G0BwHhHWPVGgtN3NGv1/UCvvN+2zv5UdGVBxrmTJQE9W7a0v\n\
kMIxPpuMqIv1f/8VHhjzAAAACXBsYW4tdGVzdAECAwQ=\n\
-----END OPENSSH PRIVATE KEY-----\n";

    #[tokio::test]
    async fn ssh_password_auth_and_echo() {
        let (port, _handle) = testing::start_echo_ssh_server().await;

        let auth = AuthConfig {
            username: "chen".into(),
            method: AuthMethod::Password("pw".into()),
        };
        let mut conn = SshProtocol::connect("127.0.0.1", port, auth, Arc::new(AcceptAllPolicy), &crate::settings::AdvancedSettings::default())
            .await
            .unwrap();
        let mut shell = conn.open_shell().await.unwrap();
        shell.write_input(b"hello").await.unwrap();
        let mut buf = Vec::new();
        let n = shell.read_output(&mut buf).await.unwrap();
        assert!(n >= 5);
        assert!(buf.starts_with(b"hello"));
        shell.close().await.unwrap();
    }

    #[tokio::test]
    async fn connects_with_ed25519_key_auth() {
        let td = tempfile::TempDir::new().unwrap();
        let key_path = td.path().join("id_ed25519");
        std::fs::write(&key_path, ED25519_PLAIN).unwrap();
        let (port, _handle) = testing::start_echo_ssh_server().await;
        let auth = AuthConfig {
            username: "test".into(),
            method: AuthMethod::Key {
                path: key_path.to_string_lossy().into_owned(),
                passphrase: None,
            },
        };
        let conn =
            SshProtocol::connect("127.0.0.1", port, auth, Arc::new(AcceptAllPolicy), &crate::settings::AdvancedSettings::default()).await;
        assert!(conn.is_ok(), "key auth should succeed: {:?}", conn.err());
    }

    #[tokio::test]
    async fn rejecting_policy_fails_connect() {
        struct RejectAll;
        #[async_trait::async_trait]
        impl crate::protocol::HostKeyPolicy for RejectAll {
            async fn verify(
                &self,
                _h: &str,
                _p: u16,
                _k: &russh::keys::PublicKey,
            ) -> bool {
                false
            }
        }
        let (port, _handle) = testing::start_echo_ssh_server().await;
        let auth = AuthConfig {
            username: "test".into(),
            method: AuthMethod::Password("pw".into()),
        };
        let res =
            SshProtocol::connect("127.0.0.1", port, auth, Arc::new(RejectAll), &crate::settings::AdvancedSettings::default()).await;
        assert!(
            res.is_err(),
            "connect must fail when policy rejects the host key"
        );
    }
}

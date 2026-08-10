//! Owns live connections keyed by UUID; drives byte pumping between the
//! underlying shell channel and subscribers.
//!
//! Note: v0.3 introduces the `Connection` trait (`protocol::Connection`) so
//! a single connection can host both a shell channel and (from Task 2) an
//! SFTP subsystem. `open_connection` establishes the transport-level
//! connection only; `open_shell` lazily opens the shell channel and spawns
//! the byte-pumping driver task. The IPC layer currently calls both back to
//! back to preserve the v0.2 UX (connect always opens a terminal).
//!
//! v0.6: each `LiveConnection` is wrapped in its own `Arc<Mutex<...>>` so
//! multiple concurrent SFTP operations (10-way directory transfers) can
//! serialize per-connection without racing on the outer map's take-out /
//! put-back pattern that the earlier design used.

use crate::error::{Error, Result};
use crate::protocol::sftp_types::{Entry, EntryKind};
use crate::protocol::{AuthConfig, Connection, HostKeyPolicy, RusshHandle, ShellHandle, SftpHandle, SshProtocol};
use crate::session::tunnel::TunnelHandle;
use crate::session::{ConnectionId, ConnectionInfo, ConnectionKind, ConnectionState};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

pub(crate) struct LiveConnection {
    pub(crate) info: ConnectionInfo,
    pub(crate) conn: Box<dyn Connection>,
    pub(crate) shell: Option<ShellDriver>,
    pub(crate) sftp: Option<SftpHandle>,
    /// Cloneable handle to the underlying russh connection.
    /// None for non-SSH or pre-v0.9 connections.
    pub(crate) ssh_handle: Option<RusshHandle>,
    /// Live tunnel tasks keyed by rule_id (Uuid string for persisted
    /// rules, ephemeral UUID string for session-only rules).
    pub(crate) tunnels: HashMap<String, TunnelHandle>,
}

/// Handle to the background task pumping bytes for this connection's shell
/// channel. Dropping the `Sender` (e.g. by removing the owning
/// `LiveConnection` from the map without sending `Close`) causes
/// `shell_driver_loop`'s `writes.recv()` to resolve to `None`, which the
/// loop treats the same as an explicit `Close`.
pub(crate) struct ShellDriver {
    writer: mpsc::Sender<ShellCmd>,
}

enum ShellCmd {
    Bytes(Vec<u8>),
    Resize(u16, u16),
    Close,
}

/// Owns every live connection (currently just SSH) keyed by `ConnectionId`.
/// Each connection's shell, once opened, is driven by its own background
/// task (`shell_driver_loop`) that pumps bytes between the underlying
/// transport and whatever subscriber is listening; the manager itself never
/// touches the transport directly once `open_shell` hands it off, so its
/// mutex is never held across I/O.
///
/// `Clone`: both fields are already `Arc<Mutex<...>>`, so cloning a
/// `SessionManager` is cheap and every clone shares the same underlying
/// connection map. This lets `TransferManager`'s spawned upload/download
/// tasks (which must outlive the IPC call that started them, and therefore
/// need an owned handle) capture a clone without requiring the Tauri-managed
/// `SessionManager` itself to be wrapped in `Arc` — `State<'_, SessionManager>`
/// in IPC handlers is unaffected.
#[derive(Clone)]
pub struct SessionManager {
    // Per-connection mutex: outer lock is held only for map lookup / insert /
    // remove; per-connection Mutex is held across the SFTP or shell-open
    // .await so concurrent ops on the same connection serialize cleanly
    // instead of racing on a take-out / put-back pattern.
    inner: Arc<Mutex<HashMap<ConnectionId, Arc<Mutex<LiveConnection>>>>>,
    // For subscribe(): map id -> channel to forward read bytes to. Only a
    // single consumer per connection is supported (see driver_loop invariant
    // carried over from v0.1/v0.2).
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
            subs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Establishes the transport-level SSH connection and authenticates,
    /// but does not open any channel (shell or SFTP) yet.
    pub async fn open_connection(
        &self,
        host: &str,
        port: u16,
        auth: AuthConfig,
        label: String,
        host_id: Option<Uuid>,
        policy: Arc<dyn HostKeyPolicy>,
    ) -> Result<ConnectionInfo> {
        let ssh_conn = SshProtocol::connect(host, port, auth, policy).await?;
        let ssh_handle = Some(ssh_conn.handle_clone());
        let id = Uuid::new_v4();
        let info = ConnectionInfo {
            id,
            label,
            kind: ConnectionKind::Ssh,
            host_id,
            state: ConnectionState::Active,
        };
        let live = LiveConnection {
            info: info.clone(),
            conn: Box::new(ssh_conn),
            shell: None,
            sftp: None,
            ssh_handle,
            tunnels: HashMap::new(),
        };
        self.inner
            .lock()
            .await
            .insert(id, Arc::new(Mutex::new(live)));
        Ok(info)
    }

    /// Cheap Arc-clone lookup. Callers get an owned handle to the live
    /// entry's per-connection mutex and can `.await` on it without holding
    /// the outer map lock.
    async fn live(&self, id: ConnectionId) -> Result<Arc<Mutex<LiveConnection>>> {
        self.inner
            .lock()
            .await
            .get(&id)
            .cloned()
            .ok_or(Error::Closed)
    }

    /// Lazily opens the shell channel on an already-established connection
    /// and spawns the byte-pumping driver task. Idempotent: calling it again
    /// once a shell is already open is a no-op.
    pub async fn open_shell(&self, id: ConnectionId) -> Result<()> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        if live.shell.is_some() {
            return Ok(());
        }
        let shell_handle = live.conn.open_shell().await?;
        let (writer_tx, writer_rx) = mpsc::channel::<ShellCmd>(64);
        let subs_arc = self.subs.clone();
        let inner_arc = self.inner.clone();
        tokio::spawn(shell_driver_loop(
            id,
            shell_handle,
            writer_rx,
            subs_arc,
            inner_arc,
        ));
        live.shell = Some(ShellDriver { writer: writer_tx });
        Ok(())
    }

    pub async fn write(&self, id: ConnectionId, data: &[u8]) -> Result<()> {
        let writer = self.shell_writer(id).await?;
        writer
            .send(ShellCmd::Bytes(data.to_vec()))
            .await
            .map_err(|_| Error::Closed)?;
        Ok(())
    }

    pub async fn resize(&self, id: ConnectionId, cols: u16, rows: u16) -> Result<()> {
        let writer = self.shell_writer(id).await?;
        writer
            .send(ShellCmd::Resize(cols, rows))
            .await
            .map_err(|_| Error::Closed)?;
        Ok(())
    }

    async fn shell_writer(&self, id: ConnectionId) -> Result<mpsc::Sender<ShellCmd>> {
        let live_arc = self.live(id).await?;
        let live = live_arc.lock().await;
        let shell = live.shell.as_ref().ok_or(Error::Closed)?;
        Ok(shell.writer.clone())
    }

    pub async fn subscribe(&self, id: ConnectionId) -> Result<mpsc::Receiver<Vec<u8>>> {
        // Just check presence without holding the per-connection mutex.
        {
            let map = self.inner.lock().await;
            if !map.contains_key(&id) {
                return Err(Error::Closed);
            }
        }
        let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
        self.subs.lock().await.insert(id, tx);
        Ok(rx)
    }

    pub async fn close(&self, id: ConnectionId) -> Result<()> {
        // Abort all active tunnels before removing the connection.
        self.close_all_tunnels(id).await;
        let removed = self.inner.lock().await.remove(&id);
        if let Some(live_arc) = removed {
            let mut live = live_arc.lock().await;
            if let Some(shell) = live.shell.take() {
                let _ = shell.writer.send(ShellCmd::Close).await;
            }
            let _ = live.conn.disconnect().await;
        }
        self.subs.lock().await.remove(&id);
        Ok(())
    }

    pub async fn open_tunnel(
        &self,
        session_id: Uuid,
        rule_id: String,
        local_port: u16,
        remote_host: String,
        remote_port: u16,
        bind_all: bool,
        app: AppHandle,
    ) -> crate::error::Result<()> {
        let lc_arc = self.inner.lock().await
            .get(&session_id)
            .cloned()
            .ok_or_else(|| crate::error::Error::Protocol("session not found".into()))?;
        let mut lc = lc_arc.lock().await;
        let ssh = lc.ssh_handle.clone()
            .ok_or_else(|| crate::error::Error::Protocol("no SSH handle for this session".into()))?;
        let handle = crate::session::tunnel::spawn_tunnel(
            ssh, session_id, rule_id.clone(), local_port, remote_host, remote_port, bind_all, app,
        ).await.map_err(|e| crate::error::Error::Protocol(e))?;
        lc.tunnels.insert(rule_id, handle);
        Ok(())
    }

    pub async fn close_tunnel(&self, session_id: Uuid, rule_id: &str) -> crate::error::Result<()> {
        let lc_arc = self.inner.lock().await.get(&session_id).cloned();
        if let Some(lc_arc) = lc_arc {
            let mut lc = lc_arc.lock().await;
            if let Some(handle) = lc.tunnels.remove(rule_id) {
                handle.abort();
            }
        }
        Ok(())
    }

    /// Returns a cloned `RusshHandle` for `id`, or `None` if the session does
    /// not exist or has no SSH handle. Used by the `tunnels_only` transport
    /// monitor to probe liveness without holding the per-connection lock.
    pub async fn get_ssh_handle(&self, id: ConnectionId) -> Option<RusshHandle> {
        let lc_arc = self.inner.lock().await.get(&id).cloned()?;
        let lc = lc_arc.lock().await;
        lc.ssh_handle.clone()
    }

    pub async fn close_all_tunnels(&self, session_id: Uuid) {
        let lc_arc = self.inner.lock().await.get(&session_id).cloned();
        if let Some(lc_arc) = lc_arc {
            let mut lc = lc_arc.lock().await;
            for (_, handle) in lc.tunnels.drain() {
                handle.abort();
            }
        }
    }

    pub async fn list(&self) -> Vec<ConnectionInfo> {
        let arcs: Vec<_> = self.inner.lock().await.values().cloned().collect();
        let mut result = Vec::with_capacity(arcs.len());
        for a in arcs {
            result.push(a.lock().await.info.clone());
        }
        result
    }

    // --- SFTP delegation -------------------------------------------------

    async fn ensure_sftp(live: &mut LiveConnection) -> Result<()> {
        if live.sftp.is_none() {
            let sftp = live.conn.open_sftp().await?;
            live.sftp = Some(sftp);
        }
        Ok(())
    }

    pub async fn sftp_open_write(
        &self,
        id: ConnectionId,
        path: &str,
    ) -> Result<russh_sftp::client::fs::File> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        Self::ensure_sftp(&mut live).await?;
        live.sftp.as_ref().unwrap().open_write_stream(path).await
    }

    pub async fn sftp_open_read(
        &self,
        id: ConnectionId,
        path: &str,
    ) -> Result<russh_sftp::client::fs::File> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        Self::ensure_sftp(&mut live).await?;
        live.sftp.as_ref().unwrap().open_read_stream(path).await
    }

    pub async fn sftp_list_dir(&self, id: ConnectionId, path: &str) -> Result<Vec<Entry>> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        Self::ensure_sftp(&mut live).await?;
        live.sftp.as_ref().unwrap().list_dir(path).await
    }

    pub async fn sftp_stat(&self, id: ConnectionId, path: &str) -> Result<Entry> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        Self::ensure_sftp(&mut live).await?;
        live.sftp.as_ref().unwrap().stat(path).await
    }

    pub async fn sftp_rename(&self, id: ConnectionId, from: &str, to: &str) -> Result<()> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        Self::ensure_sftp(&mut live).await?;
        live.sftp.as_ref().unwrap().rename(from, to).await
    }

    pub async fn sftp_remove_file(&self, id: ConnectionId, path: &str) -> Result<()> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        Self::ensure_sftp(&mut live).await?;
        live.sftp.as_ref().unwrap().remove_file(path).await
    }

    pub async fn sftp_remove_dir(&self, id: ConnectionId, path: &str) -> Result<()> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        Self::ensure_sftp(&mut live).await?;
        live.sftp.as_ref().unwrap().remove_dir(path).await
    }

    pub async fn sftp_mkdir(&self, id: ConnectionId, path: &str) -> Result<()> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        Self::ensure_sftp(&mut live).await?;
        live.sftp.as_ref().unwrap().mkdir(path).await
    }

    pub async fn sftp_realpath(&self, id: ConnectionId, path: &str) -> Result<String> {
        let live_arc = self.live(id).await?;
        let mut live = live_arc.lock().await;
        Self::ensure_sftp(&mut live).await?;
        live.sftp.as_ref().unwrap().realpath(path).await
    }

    /// Recursively removes a remote directory and every file/dir under it.
    /// Files first (any order), then directories deepest-first — SFTP RMDIR
    /// requires an empty directory, so subdirs must be gone before their
    /// parents. Finally removes `root` itself.
    pub async fn sftp_remove_dir_recursive(
        &self,
        id: ConnectionId,
        root: &str,
    ) -> Result<()> {
        let walked = self.sftp_walk_dir(id, root).await?;
        // Files first — no ordering constraint between siblings.
        for e in walked.iter().filter(|e| e.kind == WalkedKind::File) {
            let abs = format!("{}/{}", root.trim_end_matches('/'), e.rel_path);
            self.sftp_remove_file(id, &abs).await?;
        }
        // Then directories, deepest-first. `sftp_walk_dir` returns dirs
        // sorted parents-first (for mkdir); reverse for bottom-up removal.
        let mut subdirs: Vec<&WalkedEntry> = walked
            .iter()
            .filter(|e| e.kind == WalkedKind::Directory)
            .collect();
        subdirs.reverse();
        for e in subdirs {
            let abs = format!("{}/{}", root.trim_end_matches('/'), e.rel_path);
            self.sftp_remove_dir(id, &abs).await?;
        }
        // Finally the root itself.
        self.sftp_remove_dir(id, root).await
    }

    /// Recursive remote walk starting at `root`. Returns entries in
    /// deterministic order: directories first (parent before children,
    /// enabling mkdir bottom-up), then files. Each entry's `name` is the
    /// path RELATIVE to `root` (with forward-slash separators); use
    /// `join_remote` to compose the destination path in the caller.
    /// Symlinks are skipped (kept out of scope for T1's directory
    /// transfer — cyclic-symlink handling is a T2 concern).
    pub async fn sftp_walk_dir(
        &self,
        id: ConnectionId,
        root: &str,
    ) -> Result<Vec<WalkedEntry>> {
        let mut dirs: Vec<String> = Vec::new(); // relative paths ("" = root)
        let mut files: Vec<WalkedEntry> = Vec::new();
        let mut queue: Vec<(String, String)> = vec![(root.to_string(), String::new())];
        while let Some((abs, rel)) = queue.pop() {
            let entries = self.sftp_list_dir(id, &abs).await?;
            for e in entries {
                if e.name == "." || e.name == ".." {
                    continue;
                }
                let child_rel = if rel.is_empty() {
                    e.name.clone()
                } else {
                    format!("{}/{}", rel, e.name)
                };
                let child_abs = format!("{}/{}", abs.trim_end_matches('/'), e.name);
                match e.kind {
                    EntryKind::Directory => {
                        dirs.push(child_rel.clone());
                        queue.push((child_abs, child_rel));
                    }
                    EntryKind::File => files.push(WalkedEntry {
                        rel_path: child_rel,
                        kind: WalkedKind::File,
                        size: e.size,
                    }),
                    EntryKind::Symlink | EntryKind::Other => {} // skip in T1
                }
            }
        }
        // Sort dirs by depth so parents come before children (mkdir order).
        dirs.sort_by_key(|s| s.matches('/').count());
        let mut out: Vec<WalkedEntry> = dirs
            .into_iter()
            .map(|d| WalkedEntry {
                rel_path: d,
                kind: WalkedKind::Directory,
                size: 0,
            })
            .collect();
        out.extend(files);
        Ok(out)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WalkedKind {
    Directory,
    File,
}

#[derive(Debug, Clone)]
pub struct WalkedEntry {
    pub rel_path: String,
    pub kind: WalkedKind,
    pub size: u64,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Per-connection background task. Owns the `ShellHandle` exclusively (the
/// `SessionManager`'s mutex is never held while this runs) and pumps bytes
/// between it and whichever channel is currently registered.
async fn shell_driver_loop(
    id: ConnectionId,
    mut shell: ShellHandle,
    mut writes: mpsc::Receiver<ShellCmd>,
    subs: Arc<Mutex<HashMap<ConnectionId, mpsc::Sender<Vec<u8>>>>>,
    inner: Arc<Mutex<HashMap<ConnectionId, Arc<Mutex<LiveConnection>>>>>,
) {
    let mut read_buf = Vec::with_capacity(4096);
    loop {
        tokio::select! {
            cmd = writes.recv() => match cmd {
                Some(ShellCmd::Bytes(b)) => {
                    let _ = shell.write_input(&b).await;
                }
                Some(ShellCmd::Resize(c, r)) => {
                    let _ = shell.resize(c, r).await;
                }
                Some(ShellCmd::Close) | None => {
                    let _ = shell.close().await;
                    break;
                }
            },
            read = shell.read_output(&mut read_buf) => match read {
                Ok(0) => break,
                Ok(_) => {
                    let chunk = std::mem::take(&mut read_buf);
                    let tx = subs.lock().await.get(&id).cloned();
                    if let Some(tx) = tx {
                        let _ = tx.send(chunk).await;
                    }
                }
                Err(_) => break,
            },
        }
    }
    subs.lock().await.remove(&id);
    inner.lock().await.remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{AcceptAllPolicy, AuthConfig, AuthMethod};
    use async_trait::async_trait;

    async fn open_ssh_with_shell(
        mgr: &SessionManager,
        port: u16,
        label: &str,
    ) -> ConnectionInfo {
        let auth = AuthConfig {
            username: "chen".into(),
            method: AuthMethod::Password("pw".into()),
        };
        let info = mgr
            .open_connection(
                "127.0.0.1",
                port,
                auth,
                label.into(),
                None,
                Arc::new(AcceptAllPolicy),
            )
            .await
            .unwrap();
        mgr.open_shell(info.id).await.unwrap();
        info
    }

    #[tokio::test]
    async fn open_and_close_ssh_session_tracks_state() {
        let (port, _handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let info = open_ssh_with_shell(&mgr, port, "test").await;
        assert_eq!(mgr.list().await.len(), 1);
        assert_eq!(info.label, "test");
        mgr.close(info.id).await.unwrap();
        assert_eq!(mgr.list().await.len(), 0);
    }

    #[tokio::test]
    async fn write_is_forwarded_to_subscriber() {
        let (port, _handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let info = open_ssh_with_shell(&mgr, port, "test").await;

        let mut rx = mgr.subscribe(info.id).await.unwrap();
        mgr.write(info.id, b"hello\n").await.unwrap();

        let chunk = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv())
            .await
            .expect("timed out waiting for echoed data")
            .expect("subscription channel closed unexpectedly");
        assert!(
            chunk.windows(5).any(|w| w == b"hello"),
            "expected chunk to contain b\"hello\", got {chunk:?}"
        );

        mgr.close(info.id).await.unwrap();
    }

    #[tokio::test]
    async fn session_closes_when_driver_exits() {
        let (port, _handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let info = open_ssh_with_shell(&mgr, port, "test").await;

        let mut rx = mgr.subscribe(info.id).await.unwrap();
        mgr.close(info.id).await.unwrap();

        let closed = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv())
            .await
            .expect("timed out waiting for subscription channel to close");
        assert!(closed.is_none(), "expected subscription channel to close");

        assert!(
            mgr.list().await.is_empty(),
            "expected no live connections after driver exit"
        );
    }

    #[tokio::test]
    async fn driver_loop_cleans_up_on_remote_eof() {
        let (port, server_handle) = crate::protocol::ssh::testing::start_echo_ssh_server().await;
        let mgr = SessionManager::new();
        let info = open_ssh_with_shell(&mgr, port, "eof-test").await;
        let mut rx = mgr.subscribe(info.id).await.unwrap();

        server_handle.abort();
        let _ = server_handle.await;

        let recv_result = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv()).await;
        assert!(
            recv_result.is_ok(),
            "subscription receiver should close within 3s of remote EOF"
        );
        assert!(
            recv_result.unwrap().is_none(),
            "receiver should return None when driver_loop cleans up subs"
        );
        assert!(
            mgr.list().await.is_empty(),
            "list should be empty after driver_loop cleans up inner"
        );
    }

    struct ShellRejectingConnection;

    #[async_trait]
    impl Connection for ShellRejectingConnection {
        async fn open_shell(&mut self) -> Result<ShellHandle> {
            Err(Error::Protocol("shell rejected".into()))
        }
        async fn open_sftp(&mut self) -> Result<SftpHandle> {
            Err(Error::Protocol("sftp rejected".into()))
        }
        async fn disconnect(&mut self) -> Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn open_shell_failure_leaves_connection_for_caller_to_close() {
        let mgr = SessionManager::new();
        let id = Uuid::new_v4();
        let info = ConnectionInfo {
            id,
            label: "shell-rejecting".into(),
            kind: ConnectionKind::Ssh,
            host_id: None,
            state: ConnectionState::Active,
        };
        mgr.inner.lock().await.insert(
            id,
            Arc::new(Mutex::new(LiveConnection {
                info,
                conn: Box::new(ShellRejectingConnection),
                shell: None,
                sftp: None,
                ssh_handle: None,
                tunnels: HashMap::new(),
            })),
        );

        let result = mgr.open_shell(id).await;
        assert!(result.is_err(), "open_shell should surface the fake failure");
        assert_eq!(
            mgr.list().await.len(),
            1,
            "connection should still be parked in `inner` after the failed open_shell"
        );

        mgr.close(id).await.unwrap();
        assert!(
            mgr.list().await.is_empty(),
            "close() must remove the connection left behind by the failed open_shell"
        );
    }
}

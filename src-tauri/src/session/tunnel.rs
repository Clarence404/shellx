//! Manages one local-forward SSH tunnel: binds a TcpListener, accepts
//! connections, and splices each through a `channel_open_direct_tcpip`
//! channel on the shared russh Handle.

use crate::protocol::RusshHandle;
use russh::ChannelMsg;
use serde::Serialize;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpSocket};
use tokio::sync::oneshot;
use uuid::Uuid;

pub const EV_TUNNEL_STATUS: &str = "tunnel:status";

#[derive(Clone, Serialize)]
pub struct TunnelStatusEvent {
    pub session_id: Uuid,
    pub rule_id: String,
    pub status: String,        // "active" | "error" | "closed"
    pub error: Option<String>,
}

/// Owns a running tunnel task. Dropping or calling `abort()` tears it down.
pub struct TunnelHandle {
    abort_tx: oneshot::Sender<()>,
}

impl TunnelHandle {
    pub fn abort(self) {
        let _ = self.abort_tx.send(());
    }
}

/// Spawn a local-forward tunnel task.
///
/// Binds `127.0.0.1:<local_port>`, then loops accepting TCP connections.
/// For each connection opens a `channel_open_direct_tcpip` SSH channel
/// to `remote_host:remote_port` and splices bytes bidirectionally.
/// Emits `tunnel:status` events on bind success and on abort.
pub async fn spawn_tunnel(
    ssh: RusshHandle,
    session_id: Uuid,
    rule_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    bind_all: bool,
    app: AppHandle,
) -> Result<TunnelHandle, String> {
    let bind_host = if bind_all { "0.0.0.0" } else { "127.0.0.1" };
    let addr: SocketAddr = format!("{bind_host}:{local_port}").parse().unwrap();
    let listener = match (|| -> std::io::Result<TcpListener> {
        let sock = TcpSocket::new_v4()?;
        // SO_REUSEADDR lets us rebind immediately after the previous session
        // closes (avoids TIME_WAIT "address already in use" on reconnect).
        sock.set_reuseaddr(true)?;
        sock.bind(addr)?;
        sock.listen(128)
    })() {
        Ok(l) => l,
        Err(e) => {
            let msg = format!("bind {bind_host}:{local_port}: {e}");
            let _ = app.emit(
                EV_TUNNEL_STATUS,
                TunnelStatusEvent {
                    session_id,
                    rule_id: rule_id.clone(),
                    status: "error".to_string(),
                    error: Some(msg.clone()),
                },
            );
            return Err(msg);
        }
    };

    let (abort_tx, mut abort_rx) = oneshot::channel::<()>();

    let app2 = app.clone();
    let rule_id2 = rule_id.clone();

    // Emit "active" immediately after successful bind.
    let _ = app.emit(
        EV_TUNNEL_STATUS,
        TunnelStatusEvent {
            session_id,
            rule_id: rule_id.clone(),
            status: "active".into(),
            error: None,
        },
    );

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut abort_rx => {
                    let _ = app2.emit(
                        EV_TUNNEL_STATUS,
                        TunnelStatusEvent {
                            session_id,
                            rule_id: rule_id2,
                            status: "closed".into(),
                            error: None,
                        },
                    );
                    break;
                }
                accepted = listener.accept() => {
                    match accepted {
                        Ok((tcp, peer)) => {
                            let ssh_clone = Arc::clone(&ssh);
                            let rh = remote_host.clone();
                            let rp = remote_port;
                            let peer_port = peer.port() as u32;
                            tokio::spawn(async move {
                                let channel_result = ssh_clone
                                    .channel_open_direct_tcpip(
                                        rh,
                                        rp as u32,
                                        "127.0.0.1".to_string(),
                                        peer_port,
                                    )
                                    .await;
                                match channel_result {
                                    Ok(channel) => splice(tcp, channel).await,
                                    Err(e) => {
                                        log::warn!("direct-tcpip failed: {e}");
                                    }
                                }
                            });
                        }
                        Err(e) => {
                            log::warn!("tunnel accept error: {e}");
                            let _ = app2.emit(
                                EV_TUNNEL_STATUS,
                                TunnelStatusEvent {
                                    session_id,
                                    rule_id: rule_id2,
                                    status: "closed".into(),
                                    error: Some(e.to_string()),
                                },
                            );
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(TunnelHandle { abort_tx })
}

async fn splice(tcp: tokio::net::TcpStream, mut channel: russh::Channel<russh::client::Msg>) {
    let (mut tcp_r, mut tcp_w) = tcp.into_split();
    let mut buf = [0u8; 8192];

    loop {
        tokio::select! {
            result = tcp_r.read(&mut buf) => {
                match result {
                    Ok(0) | Err(_) => {
                        let _ = channel.eof().await;
                        break;
                    }
                    Ok(n) => {
                        if channel.data(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if tcp_w.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }
}

use shellx::protocol::{AcceptAllPolicy, AuthConfig, AuthMethod};
use shellx::session::manager::SessionManager;
use std::sync::Arc;

#[tokio::test]
async fn e2e_open_write_read_close() {
    let (port, _srv) = shellx::protocol::ssh::testing::start_echo_ssh_server().await;
    let mgr = SessionManager::new();
    let auth = AuthConfig {
        username: "chen".into(),
        method: AuthMethod::Password("pw".into()),
    };
    let info = mgr
        .open_connection("127.0.0.1", port, auth, "e2e".into(), None, Arc::new(AcceptAllPolicy))
        .await
        .unwrap();
    mgr.open_shell(info.id).await.unwrap();
    let mut rx = mgr.subscribe(info.id).await.unwrap();
    mgr.write(info.id, b"ping\n").await.unwrap();
    let chunk = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(chunk.starts_with(b"ping"));
    mgr.close(info.id).await.unwrap();
    assert!(mgr.list().await.is_empty());
}

use shellx::protocol::{AcceptAllPolicy, AuthConfig, AuthMethod, Connection, SshProtocol};
use std::sync::Arc;
use tempfile::TempDir;

#[tokio::test]
async fn sftp_list_dir_upload_download_roundtrip() {
    // 1. Start an in-process russh server with a plain SSH auth handler
    //    and an SFTP subsystem backed by a temp directory.
    let tmp = TempDir::new().unwrap();
    let (port, _server) = shellx::protocol::ssh::testing::start_sftp_server(tmp.path().to_path_buf()).await;

    // 2. Connect + open SFTP subsystem.
    let mut conn = SshProtocol::connect(
        "127.0.0.1",
        port,
        AuthConfig {
            username: "chen".into(),
            method: AuthMethod::Password("pw".into()),
        },
        Arc::new(AcceptAllPolicy),
        &Default::default(),
    )
    .await
    .unwrap();
    let sftp = conn.open_sftp().await.unwrap();

    // 3. Start empty.
    let entries = sftp.list_dir(".").await.unwrap();
    assert!(entries.is_empty());

    // 4. Create a directory.
    sftp.mkdir("./data").await.unwrap();
    let entries = sftp.list_dir(".").await.unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "data");
    assert_eq!(entries[0].kind, shellx::protocol::sftp_types::EntryKind::Directory);

    // 5. Write a file.
    use tokio::io::AsyncWriteExt;
    let mut f = sftp.open_write_stream("./data/hello.txt").await.unwrap();
    f.write_all(b"hello world").await.unwrap();
    f.shutdown().await.unwrap();
    drop(f);

    // 6. Read it back.
    use tokio::io::AsyncReadExt;
    let mut r = sftp.open_read_stream("./data/hello.txt").await.unwrap();
    let mut got = Vec::new();
    r.read_to_end(&mut got).await.unwrap();
    assert_eq!(got, b"hello world");

    // 7. Stat.
    let meta = sftp.stat("./data/hello.txt").await.unwrap();
    assert_eq!(meta.size, 11);
    assert_eq!(meta.kind, shellx::protocol::sftp_types::EntryKind::File);

    // 8. Rename.
    sftp.rename("./data/hello.txt", "./data/world.txt").await.unwrap();

    // 9. Remove file + dir.
    sftp.remove_file("./data/world.txt").await.unwrap();
    sftp.remove_dir("./data").await.unwrap();

    let entries = sftp.list_dir(".").await.unwrap();
    assert!(entries.is_empty());
}

/// The path the tab's Files activity takes: a session opened through the
/// manager (shell open, byte pump subscribed — the whole tab shape), then
/// SFTP operations on the same session. Guards against anything holding
/// the session's lock across an await, which turns the first realpath
/// into a forever-pending "Loading…".
#[tokio::test]
async fn files_activity_path_realpath_then_list_alongside_a_live_shell() {
    use shellx::session::manager::SessionManager;
    use std::sync::Arc;

    let tmp = TempDir::new().unwrap();
    let (port, _server) =
        shellx::protocol::ssh::testing::start_sftp_server(tmp.path().to_path_buf()).await;

    let mgr = SessionManager::new();
    let auth = AuthConfig {
        username: "chen".into(),
        method: AuthMethod::Password("pw".into()),
    };
    let info = mgr
        .open_connection(
            "127.0.0.1", port, auth, "tab".into(), None,
            Arc::new(AcceptAllPolicy), &Default::default(),
        )
        .await
        .unwrap();

    // The tab shape: a live shell with its byte pump running, before any
    // SFTP is asked for.
    mgr.open_shell(info.id).await.unwrap();
    let mut rx = mgr.subscribe(info.id).await.unwrap();
    mgr.write(info.id, b"hello
").await.unwrap();
    let echoed = tokio::time::timeout(std::time::Duration::from_secs(3), rx.recv())
        .await
        .expect("shell echo")
        .unwrap();
    assert!(echoed.starts_with(b"hello"));

    // Exactly what FileBrowserView does on first open — with a deadline,
    // because the failure mode being guarded against is a hang.
    let realpath = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        mgr.sftp_realpath(info.id, "."),
    )
    .await
    .expect("sftp_realpath must not hang")
    .unwrap();
    assert!(!realpath.is_empty());

    let entries = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        mgr.sftp_list_dir(info.id, &realpath),
    )
    .await
    .expect("sftp_list_dir must not hang")
    .unwrap();
    assert!(entries.is_empty(), "fresh temp dir");

    // A second manager session against the same server — the FTP view's
    // shape — must not affect the first one's SFTP.
    let auth2 = AuthConfig {
        username: "chen".into(),
        method: AuthMethod::Password("pw".into()),
    };
    let info2 = mgr
        .open_connection(
            "127.0.0.1", port, auth2, "ftp-view".into(), None,
            Arc::new(AcceptAllPolicy), &Default::default(),
        )
        .await
        .unwrap();
    let rp2 = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        mgr.sftp_realpath(info2.id, "."),
    )
    .await
    .expect("second session's realpath must not hang")
    .unwrap();
    assert!(!rp2.is_empty());

    let again = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        mgr.sftp_list_dir(info.id, &realpath),
    )
    .await
    .expect("first session must still answer")
    .unwrap();
    assert!(again.is_empty());

    mgr.close(info2.id).await.unwrap();
    mgr.close(info.id).await.unwrap();
}

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

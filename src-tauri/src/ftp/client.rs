//! One live FTP connection.
//!
//! Thin over `suppaftp`, with one deliberate exception: listings are
//! fetched through `custom_data_command` and read as raw bytes, never
//! through `list()` or `mlsd()`. Those decode the data channel with
//! `from_utf8_lossy`, which turns a GBK filename into U+FFFD before this
//! code could ever see it. See `charset`.

use super::charset::{self, Charset};
use super::listing::{self, Format};
use crate::error::{Error, Result};
use crate::protocol::sftp_types::Entry;
use std::sync::Arc;
use suppaftp::tokio::{AsyncFtpStream, AsyncRustlsConnector, AsyncRustlsFtpStream};
use suppaftp::types::FileType;
use suppaftp::{Mode, Status};
use tokio::io::AsyncReadExt;

/// How TLS is reached, when it is reached at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tls {
    /// Plain FTP. Nothing is encrypted, including the password.
    None,
    /// `AUTH TLS` on the ordinary port: the connection starts in the
    /// clear and is upgraded before login.
    Explicit,
    /// TLS from the first byte, conventionally on port 990.
    Implicit,
}

impl Tls {
    pub fn parse(protocol: &str, mode: &str) -> Self {
        match (protocol, mode) {
            ("ftps", "implicit") => Tls::Implicit,
            ("ftps", _) => Tls::Explicit,
            _ => Tls::None,
        }
    }
}

/// Plain and TLS connections are different types in suppaftp, and every
/// call has to reach whichever one this is. One enum plus one macro
/// keeps that from becoming two copies of the client.
enum Conn {
    Plain(Box<AsyncFtpStream>),
    Tls(Box<AsyncRustlsFtpStream>),
}

macro_rules! on_conn {
    ($self:ident, |$s:ident| $body:expr) => {
        match &mut $self.conn {
            Conn::Plain($s) => $body,
            Conn::Tls($s) => $body,
        }
    };
}

pub struct FtpClient {
    conn: Conn,
    charset: Charset,
    /// Remembered after the first successful listing so every directory
    /// does not re-probe the server.
    format: Option<Format>,
    /// `None` until MLSD has been tried once.
    mlsd: Option<bool>,
}

impl FtpClient {
    pub async fn connect(
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        charset: Charset,
        passive: bool,
        tls: Tls,
    ) -> Result<Self> {
        let mut conn = match tls {
            Tls::None => Conn::Plain(Box::new(
                AsyncFtpStream::connect((host, port))
                    .await
                    .map_err(|e| Error::Protocol(format!("connect: {e}")))?,
            )),
            Tls::Implicit => Conn::Tls(Box::new(
                AsyncRustlsFtpStream::connect_secure_implicit((host, port), connector()?, host)
                    .await
                    .map_err(|e| tls_error(e, Tls::Implicit))?,
            )),
            Tls::Explicit => {
                let plain = AsyncRustlsFtpStream::connect((host, port))
                    .await
                    .map_err(|e| Error::Protocol(format!("connect: {e}")))?;
                Conn::Tls(Box::new(
                    plain
                        .into_secure(connector()?, host)
                        .await
                        .map_err(|e| tls_error(e, Tls::Explicit))?,
                ))
            }
        };

        // Binary is not optional: ASCII mode rewrites line endings
        // mid-transfer, which silently corrupts anything that is not
        // text, including the .dat files this feature exists for.
        let set_up = match &mut conn {
            Conn::Plain(s) => {
                if !passive { s.set_mode(Mode::Active); }
                match s.login(username, password).await {
                    Ok(()) => s.transfer_type(FileType::Binary).await,
                    Err(e) => Err(e),
                }
            }
            Conn::Tls(s) => {
                if !passive { s.set_mode(Mode::Active); }
                match s.login(username, password).await {
                    Ok(()) => s.transfer_type(FileType::Binary).await,
                    Err(e) => Err(e),
                }
            }
        };
        set_up.map_err(|e| Error::Protocol(format!("login: {e}")))?;

        Ok(Self { conn, charset, format: None, mlsd: None })
    }

    pub async fn pwd(&mut self) -> Result<String> {
        on_conn!(self, |s| s.pwd().await).map_err(|e| Error::Protocol(format!("pwd: {e}")))
    }

    pub async fn cwd(&mut self, path: &str) -> Result<()> {
        let arg = encode_path(path, self.charset)?;
        on_conn!(self, |s| s.cwd(&arg).await)
            .map_err(|e| Error::Protocol(format!("cwd {path}: {e}")))
    }

    pub async fn list_dir(&mut self, path: &str) -> Result<Vec<Entry>> {
        let arg = encode_path(path, self.charset)?;

        // MLSD is the only listing with a grammar, so it is worth one
        // probe per connection. A server that does not know it answers
        // 500 or 502 and we never ask again.
        if self.mlsd != Some(false) {
            match self.raw_lines(&format!("MLSD {arg}")).await {
                Ok(lines) => {
                    self.mlsd = Some(true);
                    self.format = Some(Format::Mlsd);
                    return Ok(listing::parse_all(&lines, Format::Mlsd));
                }
                Err(e) if is_unimplemented(&e) => {
                    crate::log_info!(
                        crate::logs::categories::SFTP,
                        "server has no MLSD, falling back to LIST",
                        "path": path,
                    );
                    self.mlsd = Some(false);
                }
                Err(e) => return Err(e),
            }
        }

        let lines = self.raw_lines(&format!("LIST {arg}")).await?;
        let format = match self.format {
            Some(f) if f != Format::Mlsd => f,
            _ => {
                // An empty directory tells us nothing about the format,
                // so leave it unlearned and guess again next time.
                let Some(f) = listing::detect(&lines) else {
                    return Ok(Vec::new());
                };
                crate::log_info!(
                    crate::logs::categories::SFTP,
                    "detected LIST format",
                    "format": format!("{f:?}"),
                );
                self.format = Some(f);
                f
            }
        };
        Ok(listing::parse_all(&lines, format))
    }

    /// Runs a command that opens a data connection and returns its
    /// payload split into lines, decoded with this connection's charset.
    /// The bytes are never touched before `decode` sees them.
    async fn raw_lines(&mut self, command: &str) -> Result<Vec<String>> {
        let expected = [Status::AboutToSend, Status::AlreadyOpen];
        let mut buf = Vec::new();
        let read = match &mut self.conn {
            Conn::Plain(s) => {
                let (_, mut data) = s
                    .custom_data_command(command, &expected)
                    .await
                    .map_err(|e| Error::Protocol(format!("{command}: {e}")))?;
                let read = data.read_to_end(&mut buf).await;
                s.close_data_connection(data)
                    .await
                    .map_err(|e| Error::Protocol(format!("{command} (close): {e}")))?;
                read
            }
            Conn::Tls(s) => {
                let (_, mut data) = s
                    .custom_data_command(command, &expected)
                    .await
                    .map_err(|e| Error::Protocol(format!("{command}: {e}")))?;
                let read = data.read_to_end(&mut buf).await;
                s.close_data_connection(data)
                    .await
                    .map_err(|e| Error::Protocol(format!("{command} (close): {e}")))?;
                read
            }
        };
        read.map_err(|e| Error::Protocol(format!("{command} (read): {e}")))?;

        Ok(charset::split_lines(&buf)
            .into_iter()
            .map(|line| charset::decode(line, self.charset))
            .collect())
    }

    pub async fn mkdir(&mut self, path: &str) -> Result<()> {
        let arg = encode_path(path, self.charset)?;
        on_conn!(self, |s| s.mkdir(&arg).await)
            .map_err(|e| Error::Protocol(format!("mkdir {path}: {e}")))
    }

    pub async fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        let (a, b) = (encode_path(from, self.charset)?, encode_path(to, self.charset)?);
        on_conn!(self, |s| s.rename(&a, &b).await)
            .map_err(|e| Error::Protocol(format!("rename {from}: {e}")))
    }

    pub async fn remove_file(&mut self, path: &str) -> Result<()> {
        let arg = encode_path(path, self.charset)?;
        on_conn!(self, |s| s.rm(&arg).await)
            .map_err(|e| Error::Protocol(format!("delete {path}: {e}")))
    }

    /// FTP has no recursive delete, and neither does this: a directory
    /// with anything in it comes back as a server error saying so, which
    /// is better than deleting more than was asked for.
    pub async fn remove_dir(&mut self, path: &str) -> Result<()> {
        let arg = encode_path(path, self.charset)?;
        on_conn!(self, |s| s.rmdir(&arg).await)
            .map_err(|e| Error::Protocol(format!("delete folder {path}: {e}")))
    }

    pub async fn quit(&mut self) {
        let _ = on_conn!(self, |s| s.quit().await);
    }
}

/// A path on its way to the control channel.
///
/// Known gap: `suppaftp` takes commands as `String` and writes them as
/// UTF-8, so a path whose bytes are GBK cannot be expressed. Reading GBK
/// names back works — that is the half this feature needs first — but
/// entering a directory whose own name is non-ASCII on a GBK server does
/// not, and is rejected here rather than silently sending the wrong
/// bytes. Closing it means either a patched `suppaftp` that accepts
/// bytes, or writing the control channel ourselves.
fn encode_path(path: &str, charset: Charset) -> Result<String> {
    if charset == Charset::Gbk && !path.is_ascii() {
        return Err(Error::Protocol(format!(
            "cannot send the non-ASCII path {path:?} to a GBK server yet"
        )));
    }
    Ok(path.to_string())
}

/// The OS trust store, so a certificate an IT department already put on
/// the machine is trusted here too. On a factory or corporate network
/// that is usually the only way an internal CA is reachable at all.
fn connector() -> Result<AsyncRustlsConnector> {
    let mut roots = tokio_rustls::rustls::RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().certs {
        let _ = roots.add(cert);
    }
    if roots.is_empty() {
        return Err(Error::Protocol(
            "no trusted certificates are installed on this machine, so TLS cannot be verified"
                .into(),
        ));
    }
    let config = tokio_rustls::rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(AsyncRustlsConnector::from(tokio_rustls::TlsConnector::from(
        Arc::new(config),
    )))
}

/// A failed handshake is nearly always the wrong mode, and nothing in
/// the failure says which — so the message names the other one instead
/// of surfacing a bare TLS error.
fn tls_error(e: suppaftp::FtpError, tried: Tls) -> Error {
    let advice = match tried {
        Tls::Implicit => "this server may use explicit TLS: try explicit mode on port 21",
        _ => "this server may use implicit TLS: try implicit mode on port 990",
    };
    Error::Protocol(format!("TLS failed: {e}. {advice}"))
}

/// 500 (syntax error) and 502 (not implemented) are how a server says it
/// has never heard of the command.
fn is_unimplemented(e: &Error) -> bool {
    let text = e.to_string();
    text.contains("500") || text.contains("502") || text.contains("504")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gbk_server_refuses_a_path_it_could_not_receive_correctly() {
        // Better a clear refusal than sending UTF-8 bytes to a server
        // that would read them as two mojibake characters and create a
        // directory nobody asked for.
        assert!(encode_path("/上报", Charset::Gbk).is_err());
        assert!(encode_path("/upload", Charset::Gbk).is_ok());
    }

    #[test]
    fn utf8_and_auto_pass_any_path_through() {
        for cs in [Charset::Auto, Charset::Utf8] {
            assert_eq!(encode_path("/上报", cs).unwrap(), "/上报");
        }
    }

    #[test]
    fn the_tls_mode_comes_from_the_protocol_and_the_setting() {
        assert_eq!(Tls::parse("ftp", "explicit"), Tls::None, "plain FTP is never TLS");
        assert_eq!(Tls::parse("ftps", "explicit"), Tls::Explicit);
        assert_eq!(Tls::parse("ftps", "implicit"), Tls::Implicit);
        // An unrecognised mode in a hand-edited database falls back to
        // the common one rather than refusing to connect.
        assert_eq!(Tls::parse("ftps", "nonsense"), Tls::Explicit);
    }

    #[test]
    fn a_handshake_failure_names_the_other_mode() {
        // The two modes are indistinguishable until one fails, so the
        // error has to carry the next thing to try.
        let e = tls_error(suppaftp::FtpError::SecureError("bad record".into()), Tls::Explicit);
        assert!(e.to_string().contains("implicit"), "{e}");
        let e = tls_error(suppaftp::FtpError::SecureError("bad record".into()), Tls::Implicit);
        assert!(e.to_string().contains("explicit"), "{e}");
    }

    #[test]
    fn the_unimplemented_check_reads_the_reply_code() {
        assert!(is_unimplemented(&Error::Protocol("MLSD: 502 Command not implemented".into())));
        assert!(is_unimplemented(&Error::Protocol("MLSD: 500 Unknown command".into())));
        // A permission problem is not a missing command, and must not
        // make us stop asking for MLSD on this connection.
        assert!(!is_unimplemented(&Error::Protocol("MLSD: 550 Permission denied".into())));
    }
}

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
use suppaftp::types::FileType;
use suppaftp::tokio::AsyncFtpStream;
use suppaftp::{Mode, Status};
use tokio::io::AsyncReadExt;

pub struct FtpClient {
    stream: AsyncFtpStream,
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
    ) -> Result<Self> {
        let mut stream = AsyncFtpStream::connect((host, port))
            .await
            .map_err(|e| Error::Protocol(format!("connect: {e}")))?;
        if !passive {
            stream.set_mode(Mode::Active);
        }
        stream
            .login(username, password)
            .await
            .map_err(|e| Error::Protocol(format!("login: {e}")))?;
        // Everything shellx moves is bytes. ASCII mode would rewrite line
        // endings mid-transfer, which silently corrupts anything that is
        // not text — including the .dat files this feature exists for.
        stream
            .transfer_type(FileType::Binary)
            .await
            .map_err(|e| Error::Protocol(format!("binary mode: {e}")))?;
        Ok(Self { stream, charset, format: None, mlsd: None })
    }

    pub async fn pwd(&mut self) -> Result<String> {
        self.stream
            .pwd()
            .await
            .map_err(|e| Error::Protocol(format!("pwd: {e}")))
    }

    pub async fn cwd(&mut self, path: &str) -> Result<()> {
        self.stream
            .cwd(encode_path(path, self.charset)?)
            .await
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
        let (_, mut data) = self
            .stream
            .custom_data_command(command, &[Status::AboutToSend, Status::AlreadyOpen])
            .await
            .map_err(|e| Error::Protocol(format!("{command}: {e}")))?;

        let mut buf = Vec::new();
        let read = data.read_to_end(&mut buf).await;
        self.stream
            .close_data_connection(data)
            .await
            .map_err(|e| Error::Protocol(format!("{command} (close): {e}")))?;
        read.map_err(|e| Error::Protocol(format!("{command} (read): {e}")))?;

        Ok(charset::split_lines(&buf)
            .into_iter()
            .map(|line| charset::decode(line, self.charset))
            .collect())
    }

    pub async fn quit(&mut self) {
        let _ = self.stream.quit().await;
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
    fn the_unimplemented_check_reads_the_reply_code() {
        assert!(is_unimplemented(&Error::Protocol("MLSD: 502 Command not implemented".into())));
        assert!(is_unimplemented(&Error::Protocol("MLSD: 500 Unknown command".into())));
        // A permission problem is not a missing command, and must not
        // make us stop asking for MLSD on this connection.
        assert!(!is_unimplemented(&Error::Protocol("MLSD: 550 Permission denied".into())));
    }
}

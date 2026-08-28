//! Turning FTP bytes into filenames, and filenames back into bytes.
//!
//! FTP never defined a charset for pathnames. Modern servers send UTF-8;
//! the machines this feature exists for — production-line boxes on a
//! factory network — are as likely to send GBK. Guess wrong and the user
//! sees a directory full of mojibake, or worse, sends a path the server
//! cannot resolve.
//!
//! Everything here works on raw bytes on purpose. The moment a listing
//! is decoded as lossy UTF-8, GBK bytes become U+FFFD and the original
//! is unrecoverable — which is exactly what `suppaftp`'s own `list()`
//! does, and exactly why this module exists.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Charset {
    /// UTF-8 first, GBK when the bytes are not valid UTF-8.
    #[default]
    Auto,
    Utf8,
    Gbk,
}

impl Charset {
    pub fn parse(s: &str) -> Self {
        match s {
            "utf8" => Charset::Utf8,
            "gbk" => Charset::Gbk,
            _ => Charset::Auto,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Charset::Auto => "auto",
            Charset::Utf8 => "utf8",
            Charset::Gbk => "gbk",
        }
    }
}

/// Bytes off the wire → a name to show.
///
/// `Auto` prefers UTF-8 because a valid UTF-8 sequence is almost never
/// accidental, then falls back to GBK. Neither branch can fail: GBK
/// decoding maps anything it cannot place, so a name always comes back.
/// That is deliberate — a directory listing that renders one row oddly
/// beats a listing that refuses to render.
pub fn decode(bytes: &[u8], charset: Charset) -> String {
    match charset {
        Charset::Utf8 => String::from_utf8_lossy(bytes).into_owned(),
        Charset::Gbk => encoding_rs::GBK.decode(bytes).0.into_owned(),
        Charset::Auto => match std::str::from_utf8(bytes) {
            Ok(s) => s.to_string(),
            Err(_) => encoding_rs::GBK.decode(bytes).0.into_owned(),
        },
    }
}

/// A name → bytes to put on the control channel.
///
/// `Auto` encodes as UTF-8: a path being sent came from a listing this
/// side decoded, and re-encoding it to GBK on a UTF-8 server would break
/// a path that was working. When a server needs GBK on the way out, the
/// connection is set to `Gbk` outright — that is what the manual lock in
/// the form is for.
pub fn encode(name: &str, charset: Charset) -> Vec<u8> {
    match charset {
        Charset::Gbk => encoding_rs::GBK.encode(name).0.into_owned(),
        _ => name.as_bytes().to_vec(),
    }
}

/// Splits a raw listing response into lines, without decoding anything.
/// CRLF is the protocol's line ending, but servers send bare LF too.
pub fn split_lines(bytes: &[u8]) -> Vec<&[u8]> {
    bytes
        .split(|b| *b == b'\n')
        .map(|line| line.strip_suffix(b"\r").unwrap_or(line))
        .filter(|line| !line.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // "测试.txt" in each encoding. GBK is two bytes per han character,
    // UTF-8 three.
    const UTF8: &[u8] = "测试.txt".as_bytes();
    const GBK: &[u8] = &[0xB2, 0xE2, 0xCA, 0xD4, b'.', b't', b'x', b't'];

    #[test]
    fn auto_reads_utf8_when_it_is_utf8() {
        assert_eq!(decode(UTF8, Charset::Auto), "测试.txt");
    }

    #[test]
    fn auto_falls_back_to_gbk() {
        // These bytes are not valid UTF-8, so the fallback has to catch
        // them — this is the whole reason the module exists.
        assert!(std::str::from_utf8(&GBK.to_vec()).is_err());
        assert_eq!(decode(GBK, Charset::Auto), "测试.txt");
    }

    #[test]
    fn locking_the_charset_overrides_the_guess() {
        // Told GBK, GBK bytes read correctly.
        assert_eq!(decode(GBK, Charset::Gbk), "测试.txt");
        // Told UTF-8, the same bytes come back as replacement characters
        // rather than as an error — the listing still renders.
        let wrong = decode(GBK, Charset::Utf8);
        assert!(wrong.contains('\u{FFFD}'), "got {wrong:?}");
    }

    #[test]
    fn ascii_is_the_same_under_every_setting() {
        for cs in [Charset::Auto, Charset::Utf8, Charset::Gbk] {
            assert_eq!(decode(b"report_0824.dat", cs), "report_0824.dat");
        }
    }

    #[test]
    fn a_path_survives_a_round_trip() {
        for cs in [Charset::Auto, Charset::Utf8, Charset::Gbk] {
            let name = "上报/测试.txt";
            assert_eq!(decode(&encode(name, cs), cs), name);
        }
    }

    #[test]
    fn gbk_encoding_produces_the_bytes_the_server_expects() {
        assert_eq!(encode("测试.txt", Charset::Gbk), GBK);
        assert_eq!(encode("测试.txt", Charset::Utf8), UTF8);
        // Auto sends UTF-8: the path came from a listing we decoded, and
        // re-encoding it would break a server that was working.
        assert_eq!(encode("测试.txt", Charset::Auto), UTF8);
    }

    #[test]
    fn lines_split_on_either_ending() {
        let raw = b"one\r\ntwo\nthree\r\n";
        let lines = split_lines(raw);
        assert_eq!(lines, vec![&b"one"[..], &b"two"[..], &b"three"[..]]);
    }

    #[test]
    fn blank_lines_are_dropped_not_returned_as_empty_names() {
        assert_eq!(split_lines(b"\r\n\r\nfile\r\n"), vec![&b"file"[..]]);
        assert!(split_lines(b"").is_empty());
    }

    #[test]
    fn splitting_never_decodes() {
        // The bytes must come out untouched, or the fallback above would
        // have nothing left to work with.
        let mut raw = GBK.to_vec();
        raw.extend_from_slice(b"\r\n");
        assert_eq!(split_lines(&raw), vec![GBK]);
    }

    #[test]
    fn the_charset_name_round_trips_through_storage() {
        for cs in [Charset::Auto, Charset::Utf8, Charset::Gbk] {
            assert_eq!(Charset::parse(cs.as_str()), cs);
        }
        // Anything unrecognised in a hand-edited database falls back to
        // the safe guess rather than refusing to load the row.
        assert_eq!(Charset::parse("latin1"), Charset::Auto);
    }
}

//! Reading a directory listing back from an FTP server.
//!
//! Three formats, because FTP standardised the command and not the
//! answer:
//!
//! - `MLSD` (RFC 3659) — the only one with a grammar. Types and
//!   timestamps are machine-readable. Ask for this first.
//! - `LIST` in POSIX form — what `ls -l` prints, which is to say a
//!   format designed for a person.
//! - `LIST` in DOS/IIS form — a different format designed for a
//!   different person.
//!
//! Every parser takes an already-decoded line (see `charset`) and
//! returns the same `Entry` the SFTP side returns, so the frontend never
//! learns which protocol it is looking at.
//!
//! A line that cannot be parsed becomes an entry with a name and nothing
//! else, never an error. Old boxes emit surprising lines, and a
//! directory that renders one row poorly is worth more than a directory
//! that refuses to render.

use crate::protocol::sftp_types::{Entry, EntryKind};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Mlsd,
    Posix,
    Dos,
}

/// Parses one line in a known format. `None` means "this line is not
/// that format", which is how `detect` picks between them.
pub fn parse_line(line: &str, format: Format) -> Option<Entry> {
    match format {
        Format::Mlsd => parse_mlsd(line),
        Format::Posix => parse_posix(line),
        Format::Dos => parse_dos(line),
    }
}

/// Picks the format a `LIST` response is in by trying each parser on the
/// first line that any of them recognises. Servers do not announce this,
/// so it has to be guessed once and then remembered per connection.
pub fn detect(lines: &[String]) -> Option<Format> {
    for line in lines {
        for format in [Format::Mlsd, Format::Posix, Format::Dos] {
            if parse_line(line, format).is_some() {
                return Some(format);
            }
        }
    }
    None
}

/// Parses a whole listing, dropping `.` and `..` (the frontend supplies
/// its own way up) and degrading unparseable lines rather than failing.
pub fn parse_all(lines: &[String], format: Format) -> Vec<Entry> {
    lines
        .iter()
        .filter_map(|line| {
            let entry = parse_line(line, format).unwrap_or_else(|| unreadable(line));
            match entry.name.as_str() {
                "" | "." | ".." => None,
                _ => Some(entry),
            }
        })
        .collect()
}

/// The last resort: show the line as a name so the file is at least
/// visible and selectable.
fn unreadable(line: &str) -> Entry {
    Entry {
        name: line.trim().to_string(),
        kind: EntryKind::Other,
        size: 0,
        modified: None,
        permissions: 0,
    }
}

// ------------------------------------------------------------- MLSD

/// `type=file;size=860160;modify=20260824140000; report.dat`
///
/// Facts are `name=value` pairs separated by semicolons, then a space,
/// then the filename — which may itself contain spaces and semicolons,
/// so the split is on the FIRST space after the facts.
fn parse_mlsd(line: &str) -> Option<Entry> {
    let (facts, name) = line.split_once(' ')?;
    if !facts.ends_with(';') || !facts.contains('=') {
        return None;
    }
    let name = name.trim_start();
    if name.is_empty() {
        return None;
    }

    let mut kind = EntryKind::Other;
    let mut size = 0u64;
    let mut modified = None;
    let mut permissions = 0u32;

    for fact in facts.split(';').filter(|f| !f.is_empty()) {
        let (key, value) = fact.split_once('=')?;
        match key.to_ascii_lowercase().as_str() {
            "type" => {
                kind = match value.to_ascii_lowercase().as_str() {
                    "dir" | "cdir" | "pdir" => EntryKind::Directory,
                    "file" => EntryKind::File,
                    // OS.unix=slink:/target — the type carries the target
                    // after a colon, which we do not need here.
                    v if v.starts_with("os.unix=slink") => EntryKind::Symlink,
                    _ => EntryKind::Other,
                }
            }
            "size" => size = value.parse().unwrap_or(0),
            "modify" => modified = parse_mlsd_time(value),
            "unix.mode" => permissions = u32::from_str_radix(value, 8).unwrap_or(0),
            _ => {}
        }
    }

    // `cdir` / `pdir` are the directory itself and its parent; naming
    // them by their fact rather than their (server-chosen) name keeps
    // the filter in `parse_all` honest.
    let name = match facts.to_ascii_lowercase() {
        f if f.contains("type=cdir") => ".".to_string(),
        f if f.contains("type=pdir") => "..".to_string(),
        _ => name.to_string(),
    };

    Some(Entry { name, kind, size, modified, permissions })
}

/// `YYYYMMDDHHMMSS`, UTC by definition of RFC 3659.
fn parse_mlsd_time(s: &str) -> Option<i64> {
    let digits = s.split('.').next()?; // fractional seconds are optional
    if digits.len() < 14 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n = |a: usize, b: usize| digits[a..b].parse::<i64>().ok();
    to_unix_ms(n(0, 4)?, n(4, 6)?, n(6, 8)?, n(8, 10)?, n(10, 12)?, n(12, 14)?)
}

// ------------------------------------------------------------ POSIX

/// `-rw-r--r--   1 owner group      860160 Aug 24 14:00 report.dat`
///
/// The eight leading fields are fixed; everything after them is the
/// name, spaces and all. A year in the time column means the file is
/// old enough that the clock time was dropped.
fn parse_posix(line: &str) -> Option<Entry> {
    let mode = line.split_whitespace().next()?;
    if mode.len() < 10 || !mode.is_ascii() {
        return None;
    }
    let kind = match mode.as_bytes()[0] {
        b'd' => EntryKind::Directory,
        b'-' => EntryKind::File,
        b'l' => EntryKind::Symlink,
        b'b' | b'c' | b'p' | b's' => EntryKind::Other,
        _ => return None,
    };

    // Fields: mode links owner group size month day time-or-year name…
    // `splitn` would not do: it counts separators before empties are
    // filtered, and these listings are padded with runs of spaces.
    let (fields, rest) = fields_and_rest(line, 8)?;
    let size: u64 = fields[4].parse().ok()?;
    let (month, day, time_or_year) = (fields[5], fields[6], fields[7]);
    let rest = rest.trim();
    if rest.is_empty() {
        return None;
    }

    // `name -> target` for symlinks: the arrow is not part of the name.
    let name = match kind {
        EntryKind::Symlink => rest.split(" -> ").next().unwrap_or(rest),
        _ => rest,
    };

    Some(Entry {
        name: name.to_string(),
        kind,
        size,
        modified: parse_posix_time(month, day, time_or_year),
        permissions: posix_mode_bits(mode),
    })
}

/// `Aug 24 14:00` (this year, near enough) or `Aug 24 2024`.
///
/// The year is genuinely absent in the first form — `ls` drops it for
/// recent files — so this is an approximation by construction. It is
/// only ever used for display and sorting, and MLSD is preferred
/// precisely because it does not have this problem.
fn parse_posix_time(month: &str, day: &str, time_or_year: &str) -> Option<i64> {
    const MONTHS: [&str; 12] = [
        "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    let m = MONTHS.iter().position(|m| *m == month.to_ascii_lowercase())? as i64 + 1;
    let d: i64 = day.parse().ok()?;

    if let Some((h, min)) = time_or_year.split_once(':') {
        // No year given. Assume the current one; a file dated in the
        // future by more than a day is last year's.
        let now_year = current_year();
        let stamp = to_unix_ms(now_year, m, d, h.parse().ok()?, min.parse().ok()?, 0)?;
        let now = now_ms();
        return Some(if stamp > now + 86_400_000 {
            to_unix_ms(now_year - 1, m, d, h.parse().ok()?, min.parse().ok()?, 0)?
        } else {
            stamp
        });
    }
    to_unix_ms(time_or_year.parse().ok()?, m, d, 0, 0, 0)
}

/// The first `n` whitespace-separated fields, plus everything after
/// them with its own spacing intact — which is where a filename lives.
fn fields_and_rest(line: &str, n: usize) -> Option<(Vec<&str>, &str)> {
    let mut fields = Vec::with_capacity(n);
    let mut idx = 0;
    let bytes = line.as_bytes();
    for _ in 0..n {
        while idx < bytes.len() && bytes[idx].is_ascii_whitespace() {
            idx += 1;
        }
        let start = idx;
        while idx < bytes.len() && !bytes[idx].is_ascii_whitespace() {
            idx += 1;
        }
        if start == idx {
            return None;
        }
        fields.push(&line[start..idx]);
    }
    Some((fields, &line[idx..]))
}

fn posix_mode_bits(mode: &str) -> u32 {
    let b = mode.as_bytes();
    if b.len() < 10 {
        return 0;
    }
    let mut bits = 0u32;
    for (i, flag) in [(1usize, 0o400), (2, 0o200), (3, 0o100),
                      (4, 0o40), (5, 0o20), (6, 0o10),
                      (7, 0o4), (8, 0o2), (9, 0o1)] {
        if b[i] != b'-' {
            bits |= flag;
        }
    }
    bits
}

// -------------------------------------------------------------- DOS

/// `08-24-26  02:00PM               860160 report.dat`
/// `08-24-26  02:00PM       <DIR>          upload`
fn parse_dos(line: &str) -> Option<Entry> {
    let mut it = line.split_whitespace();
    let date = it.next()?;
    let time = it.next()?;
    let size_or_dir = it.next()?;

    let (mm, rest) = date.split_once('-')?;
    let (dd, yy) = rest.split_once('-')?;
    if mm.len() != 2 || dd.len() != 2 || !(yy.len() == 2 || yy.len() == 4) {
        return None;
    }

    let (kind, size) = if size_or_dir.eq_ignore_ascii_case("<dir>") {
        (EntryKind::Directory, 0)
    } else {
        (EntryKind::File, size_or_dir.replace(',', "").parse().ok()?)
    };

    // The name is the remainder of the line after the third field, kept
    // whole so spaces survive.
    let after = line.find(size_or_dir)? + size_or_dir.len();
    let name = line[after..].trim();
    if name.is_empty() {
        return None;
    }

    Some(Entry {
        name: name.to_string(),
        kind,
        size,
        modified: parse_dos_time(mm, dd, yy, time),
        permissions: 0,
    })
}

fn parse_dos_time(mm: &str, dd: &str, yy: &str, time: &str) -> Option<i64> {
    let year: i64 = yy.parse().ok()?;
    // Two-digit years: IIS has been shipping this format since well
    // before 2000, but no FTP server is dating files to 1970 either.
    let year = if yy.len() == 2 {
        if year < 70 { 2000 + year } else { 1900 + year }
    } else {
        year
    };

    let upper = time.to_ascii_uppercase();
    let (clock, pm) = match upper.strip_suffix("PM") {
        Some(c) => (c, true),
        None => (upper.strip_suffix("AM").unwrap_or(&upper), false),
    };
    let (h, min) = clock.split_once(':')?;
    let mut hour: i64 = h.trim().parse().ok()?;
    if pm && hour != 12 {
        hour += 12;
    }
    if !pm && hour == 12 && upper.ends_with("AM") {
        hour = 0;
    }
    to_unix_ms(year, mm.parse().ok()?, dd.parse().ok()?, hour, min.parse().ok()?, 0)
}

// ------------------------------------------------------------- time

/// Days since the unix epoch for a civil date, by Howard Hinnant's
/// `days_from_civil`. Pulling in a date crate for six lines of integer
/// arithmetic is not worth the dependency.
fn to_unix_ms(y: i64, m: i64, d: i64, hh: i64, mm: i64, ss: i64) -> Option<i64> {
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) || hh > 23 || mm > 59 || ss > 60 {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400) + hh * 3600 + mm * 60 + ss) * 1000)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn current_year() -> i64 {
    // Inverse of the civil-date arithmetic above, to the precision a
    // year needs.
    let days = now_ms() / 86_400_000 + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let doe = days - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    if mp >= 10 { y + 1 } else { y }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(line: &str, format: Format) -> Entry {
        parse_line(line, format).unwrap_or_else(|| panic!("failed to parse {line:?}"))
    }

    // ---- MLSD

    #[test]
    fn mlsd_reads_type_size_and_time() {
        let e = one(
            "type=file;size=860160;modify=20260824140000; report_0824.dat",
            Format::Mlsd,
        );
        assert_eq!(e.name, "report_0824.dat");
        assert_eq!(e.kind, EntryKind::File);
        assert_eq!(e.size, 860_160);
        // 2026-08-24 14:00:00 UTC
        assert_eq!(e.modified, Some(1_787_580_000_000));
    }

    #[test]
    fn mlsd_directories_and_modes() {
        let e = one("type=dir;sizd=4096;UNIX.mode=0755; upload", Format::Mlsd);
        assert_eq!(e.kind, EntryKind::Directory);
        assert_eq!(e.permissions, 0o755);
    }

    #[test]
    fn mlsd_keeps_spaces_in_names() {
        let e = one("type=file;size=10; a file with spaces.txt", Format::Mlsd);
        assert_eq!(e.name, "a file with spaces.txt");
    }

    #[test]
    fn mlsd_marks_the_dot_entries_by_fact_not_by_name() {
        // Servers name these whatever they like; the fact is the truth,
        // and parse_all filters on the name it produces.
        assert_eq!(one("type=cdir;modify=20260824140000; /upload", Format::Mlsd).name, ".");
        assert_eq!(one("type=pdir;modify=20260824140000; /", Format::Mlsd).name, "..");
    }

    #[test]
    fn mlsd_missing_facts_do_not_sink_the_line() {
        let e = one("type=file; mystery.bin", Format::Mlsd);
        assert_eq!(e.size, 0);
        assert_eq!(e.modified, None);
    }

    #[test]
    fn mlsd_rejects_a_posix_line() {
        assert!(parse_line("-rw-r--r-- 1 a b 10 Aug 24 14:00 f", Format::Mlsd).is_none());
    }

    // ---- POSIX

    #[test]
    fn posix_reads_a_file() {
        let e = one("-rw-r--r--   1 ftpuser ftpgroup   860160 Aug 24 14:00 report.dat", Format::Posix);
        assert_eq!(e.name, "report.dat");
        assert_eq!(e.kind, EntryKind::File);
        assert_eq!(e.size, 860_160);
        assert_eq!(e.permissions, 0o644);
    }

    #[test]
    fn posix_reads_a_directory_with_a_year_instead_of_a_clock() {
        let e = one("drwxr-xr-x   2 root root       4096 Jan  3  2024 upload", Format::Posix);
        assert_eq!(e.name, "upload");
        assert_eq!(e.kind, EntryKind::Directory);
        assert_eq!(e.permissions, 0o755);
        assert_eq!(e.modified, Some(1_704_240_000_000)); // 2024-01-03 UTC
    }

    #[test]
    fn posix_keeps_spaces_and_drops_the_symlink_target() {
        assert_eq!(
            one("-rw-r--r-- 1 a b 10 Aug 24 14:00 my report.dat", Format::Posix).name,
            "my report.dat",
        );
        let link = one("lrwxrwxrwx 1 a b 7 Aug 24 14:00 latest -> report.dat", Format::Posix);
        assert_eq!(link.name, "latest");
        assert_eq!(link.kind, EntryKind::Symlink);
    }

    #[test]
    fn posix_rejects_lines_that_are_not_listings() {
        assert!(parse_line("total 24", Format::Posix).is_none());
        assert!(parse_line("", Format::Posix).is_none());
        assert!(parse_line("08-24-26  02:00PM  10 f.txt", Format::Posix).is_none());
    }

    // ---- DOS

    #[test]
    fn dos_reads_a_file() {
        let e = one("08-24-26  02:00PM               860160 report.dat", Format::Dos);
        assert_eq!(e.name, "report.dat");
        assert_eq!(e.kind, EntryKind::File);
        assert_eq!(e.size, 860_160);
        assert_eq!(e.modified, Some(1_787_580_000_000)); // 2026-08-24 14:00 UTC
    }

    #[test]
    fn dos_reads_a_directory() {
        let e = one("08-24-26  09:30AM       <DIR>          upload", Format::Dos);
        assert_eq!(e.name, "upload");
        assert_eq!(e.kind, EntryKind::Directory);
        assert_eq!(e.size, 0);
    }

    #[test]
    fn dos_handles_midnight_noon_and_thousands_separators() {
        assert_eq!(one("01-01-26  12:00AM  1,048,576 a.bin", Format::Dos).size, 1_048_576);
        let midnight = one("01-01-26  12:00AM  10 a.bin", Format::Dos).modified.unwrap();
        let noon = one("01-01-26  12:00PM  10 a.bin", Format::Dos).modified.unwrap();
        assert_eq!(noon - midnight, 12 * 3600 * 1000);
    }

    #[test]
    fn dos_keeps_spaces_in_names() {
        assert_eq!(
            one("08-24-26  02:00PM               10 my report.dat", Format::Dos).name,
            "my report.dat",
        );
    }

    // ---- detection and whole listings

    #[test]
    fn detect_picks_the_format_from_the_lines() {
        let mlsd = vec!["type=file;size=1;modify=20260824140000; a".to_string()];
        let posix = vec!["-rw-r--r-- 1 a b 1 Aug 24 14:00 a".to_string()];
        let dos = vec!["08-24-26  02:00PM  1 a".to_string()];
        assert_eq!(detect(&mlsd), Some(Format::Mlsd));
        assert_eq!(detect(&posix), Some(Format::Posix));
        assert_eq!(detect(&dos), Some(Format::Dos));
        assert_eq!(detect(&[]), None);
    }

    #[test]
    fn detect_skips_a_leading_total_line() {
        // `ls -l` prints a total; it is not an entry, and it must not
        // decide the format.
        let lines = vec![
            "total 24".to_string(),
            "-rw-r--r-- 1 a b 1 Aug 24 14:00 a".to_string(),
        ];
        assert_eq!(detect(&lines), Some(Format::Posix));
    }

    #[test]
    fn parse_all_drops_the_dot_entries() {
        let lines = vec![
            "drwxr-xr-x 2 a b 4096 Aug 24 14:00 .".to_string(),
            "drwxr-xr-x 2 a b 4096 Aug 24 14:00 ..".to_string(),
            "-rw-r--r-- 1 a b 10 Aug 24 14:00 report.dat".to_string(),
        ];
        let out = parse_all(&lines, Format::Posix);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "report.dat");
    }

    #[test]
    fn an_unreadable_line_still_shows_up_as_a_name() {
        // Old boxes emit surprising lines. Losing the file silently
        // would be worse than showing it without metadata.
        let lines = vec![
            "-rw-r--r-- 1 a b 10 Aug 24 14:00 good.dat".to_string(),
            "!! device busy !!".to_string(),
        ];
        let out = parse_all(&lines, Format::Posix);
        assert_eq!(out.len(), 2);
        assert_eq!(out[1].name, "!! device busy !!");
        assert_eq!(out[1].kind, EntryKind::Other);
        assert_eq!(out[1].size, 0);
    }

    #[test]
    fn the_civil_date_arithmetic_matches_known_stamps() {
        assert_eq!(to_unix_ms(1970, 1, 1, 0, 0, 0), Some(0));
        assert_eq!(to_unix_ms(2000, 3, 1, 0, 0, 0), Some(951_868_800_000));
        assert_eq!(to_unix_ms(2024, 2, 29, 12, 0, 0), Some(1_709_208_000_000));
        assert_eq!(to_unix_ms(2026, 8, 24, 14, 0, 0), Some(1_787_580_000_000));
        // Out-of-range fields are rejected rather than wrapping.
        assert_eq!(to_unix_ms(2026, 13, 1, 0, 0, 0), None);
        assert_eq!(to_unix_ms(2026, 1, 1, 25, 0, 0), None);
    }
}

//! Reading `~/.ssh/config` well enough to offer its hosts for import.
//!
//! This is deliberately not a full ssh_config implementation — it answers
//! one question: which concrete machines does this file describe, and with
//! what user, port and key. Anything that isn't a machine you could click
//! and connect to (wildcards, `Match` blocks, `Include` lines) is reported
//! as skipped, with the reason, rather than silently dropped: a file whose
//! entries half-vanish is worse than one that explains itself.
//!
//! What it does honour is OpenSSH's resolution order, because getting that
//! wrong changes which user you connect as. For any given alias, the FIRST
//! value seen for a keyword — reading the file top to bottom across every
//! block whose patterns match that alias — wins. That is why a `Host *`
//! block at the end of the file supplies defaults, while the same keyword
//! in a specific block earlier overrides it.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Why an entry in the file isn't offered for import.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    /// `Host *`, `Host *.internal`, `Host web-?` — a pattern, not a machine.
    Wildcard,
    /// `Host !staging` — an exclusion, meaningless on its own.
    Negated,
    /// `Match exec …` and friends: conditional, can't be resolved here.
    MatchBlock,
    /// `Include ~/.ssh/conf.d/*` — the file points at more files.
    Include,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkippedEntry {
    pub pattern: String,
    pub reason: SkipReason,
}

/// One importable machine, with every value already resolved.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConfigHost {
    /// The `Host` alias — what you type after `ssh`. Becomes the label.
    pub alias: String,
    /// `HostName`, falling back to the alias, which is what ssh does.
    pub host_name: String,
    pub user: String,
    /// True when no `User` applied and the local account name was used —
    /// the same guess ssh makes, but worth showing before it is saved.
    pub user_inferred: bool,
    pub port: u16,
    /// `IdentityFile`, `~` expanded. Its presence selects publickey auth.
    pub identity_file: Option<String>,
    /// Carried only so the UI can say this host reaches through a jump
    /// host that shellx won't set up. Not imported.
    pub proxy_jump: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub path: String,
    pub exists: bool,
    pub hosts: Vec<ConfigHost>,
    pub skipped: Vec<SkippedEntry>,
}

pub fn default_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("config"))
}

pub fn scan(path: &Path, local_user: &str) -> ScanResult {
    let text = std::fs::read_to_string(path).ok();
    let exists = text.is_some();
    let (hosts, skipped) = match &text {
        Some(t) => parse(t, local_user),
        None => (Vec::new(), Vec::new()),
    };
    ScanResult {
        path: path.display().to_string(),
        exists,
        hosts,
        skipped,
    }
}

// ---------------------------------------------------------------- parsing

#[derive(Debug)]
struct Block {
    patterns: Vec<String>,
    is_match: bool,
    entries: Vec<(String, String)>,
}

/// Split a config line into keyword and argument. OpenSSH accepts
/// `Keyword value`, `Keyword = value` and quoted arguments; only a line
/// whose first non-blank character is `#` is a comment (an inline `#` is
/// part of the value, which surprises people but is the actual rule).
fn split_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let (key, rest) = match trimmed.find(|c: char| c.is_whitespace() || c == '=') {
        Some(i) => (&trimmed[..i], trimmed[i..].trim_start_matches(['=', ' ', '\t'])),
        None => (trimmed, ""),
    };
    Some((key.to_ascii_lowercase(), unquote(rest.trim()).to_string()))
}

fn unquote(s: &str) -> &str {
    let b = s.as_bytes();
    if b.len() >= 2 && b[0] == b'"' && b[b.len() - 1] == b'"' {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

/// `*` matches any run of characters, `?` exactly one — the only two
/// wildcards ssh_config patterns use.
fn glob_match(pattern: &str, name: &str) -> bool {
    fn walk(p: &[char], n: &[char]) -> bool {
        match p.first() {
            None => n.is_empty(),
            Some('*') => walk(&p[1..], n) || (!n.is_empty() && walk(p, &n[1..])),
            Some('?') => !n.is_empty() && walk(&p[1..], &n[1..]),
            Some(c) => !n.is_empty() && n[0] == *c && walk(&p[1..], &n[1..]),
        }
    }
    walk(
        &pattern.chars().collect::<Vec<_>>(),
        &name.chars().collect::<Vec<_>>(),
    )
}

fn is_pattern(s: &str) -> bool {
    s.contains('*') || s.contains('?')
}

/// Does this block apply to `alias`? A block matches when one of its
/// positive patterns matches and none of its negated ones do.
fn block_applies(block: &Block, alias: &str) -> bool {
    let mut positive = false;
    for p in &block.patterns {
        if let Some(neg) = p.strip_prefix('!') {
            if glob_match(neg, alias) {
                return false;
            }
        } else if glob_match(p, alias) {
            positive = true;
        }
    }
    positive
}

/// First value for `key` across every applicable block, in file order —
/// OpenSSH's rule, and the reason `Host *` at the end acts as defaults.
fn resolve<'a>(blocks: &'a [Block], alias: &str, key: &str) -> Option<&'a str> {
    for b in blocks.iter().filter(|b| !b.is_match && block_applies(b, alias)) {
        for (k, v) in &b.entries {
            if k == key {
                return Some(v);
            }
        }
    }
    None
}

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).display().to_string();
        }
    }
    path.to_string()
}

pub fn parse(text: &str, local_user: &str) -> (Vec<ConfigHost>, Vec<SkippedEntry>) {
    let mut blocks: Vec<Block> = Vec::new();
    let mut skipped: Vec<SkippedEntry> = Vec::new();

    for line in text.lines() {
        let Some((key, value)) = split_line(line) else { continue };
        match key.as_str() {
            "host" => {
                let patterns: Vec<String> =
                    value.split_whitespace().map(|s| s.to_string()).collect();
                blocks.push(Block { patterns, is_match: false, entries: Vec::new() });
            }
            "match" => {
                skipped.push(SkippedEntry {
                    pattern: format!("Match {value}"),
                    reason: SkipReason::MatchBlock,
                });
                blocks.push(Block {
                    patterns: Vec::new(),
                    is_match: true,
                    entries: Vec::new(),
                });
            }
            "include" => {
                skipped.push(SkippedEntry {
                    pattern: value.clone(),
                    reason: SkipReason::Include,
                });
            }
            _ => {
                if let Some(b) = blocks.last_mut() {
                    b.entries.push((key, value));
                }
            }
        }
    }

    // Every concrete alias in the file, in the order it appears, without
    // repeats — the same alias can legitimately head two blocks.
    let mut aliases: Vec<String> = Vec::new();
    for b in blocks.iter().filter(|b| !b.is_match) {
        for p in &b.patterns {
            if let Some(neg) = p.strip_prefix('!') {
                skipped.push(SkippedEntry {
                    pattern: format!("!{neg}"),
                    reason: SkipReason::Negated,
                });
            } else if is_pattern(p) {
                skipped.push(SkippedEntry {
                    pattern: p.clone(),
                    reason: SkipReason::Wildcard,
                });
            } else if !aliases.iter().any(|a| a == p) {
                aliases.push(p.clone());
            }
        }
    }

    let hosts = aliases
        .into_iter()
        .map(|alias| {
            let user = resolve(&blocks, &alias, "user").map(|s| s.to_string());
            ConfigHost {
                host_name: resolve(&blocks, &alias, "hostname")
                    .unwrap_or(&alias)
                    .to_string(),
                user_inferred: user.is_none(),
                user: user.unwrap_or_else(|| local_user.to_string()),
                port: resolve(&blocks, &alias, "port")
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(22),
                identity_file: resolve(&blocks, &alias, "identityfile").map(expand_tilde),
                proxy_jump: resolve(&blocks, &alias, "proxyjump").map(|s| s.to_string()),
                alias,
            }
        })
        .collect();

    (hosts, skipped)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hosts(text: &str) -> Vec<ConfigHost> {
        parse(text, "local").0
    }

    #[test]
    fn reads_a_plain_block() {
        let h = hosts("Host web\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\n");
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].alias, "web");
        assert_eq!(h[0].host_name, "10.0.0.5");
        assert_eq!(h[0].user, "deploy");
        assert_eq!(h[0].port, 2222);
        assert!(!h[0].user_inferred);
    }

    #[test]
    fn falls_back_the_way_ssh_does() {
        // No HostName: the alias is the address. No Port: 22. No User: the
        // local account, flagged so the UI can say so.
        let h = hosts("Host router\n");
        assert_eq!(h[0].host_name, "router");
        assert_eq!(h[0].port, 22);
        assert_eq!(h[0].user, "local");
        assert!(h[0].user_inferred);
    }

    #[test]
    fn a_wildcard_block_supplies_defaults() {
        let h = hosts("Host web\n  HostName 10.0.0.5\n\nHost *\n  User chen\n  Port 2200\n");
        assert_eq!(h.len(), 1, "the wildcard block itself is not a host");
        assert_eq!(h[0].user, "chen");
        assert_eq!(h[0].port, 2200);
        assert!(!h[0].user_inferred);
    }

    #[test]
    fn the_first_value_wins_not_the_most_specific() {
        // OpenSSH takes the first value it sees reading downwards, which is
        // why the specific block has to come first to win.
        let h = hosts("Host web\n  User deploy\n\nHost *\n  User chen\n");
        assert_eq!(h[0].user, "deploy");
        let flipped = hosts("Host *\n  User chen\n\nHost web\n  User deploy\n");
        assert_eq!(flipped[0].user, "chen", "a leading Host * shadows later blocks");
    }

    #[test]
    fn one_block_can_name_several_hosts() {
        let h = hosts("Host alpha beta\n  User ops\n");
        assert_eq!(h.iter().map(|x| x.alias.as_str()).collect::<Vec<_>>(), ["alpha", "beta"]);
        assert!(h.iter().all(|x| x.user == "ops"));
    }

    #[test]
    fn negation_keeps_a_block_from_applying() {
        let h = hosts("Host * !secret\n  User common\n\nHost secret\n  HostName 10.0.0.9\n");
        let secret = h.iter().find(|x| x.alias == "secret").unwrap();
        assert_eq!(secret.user, "local", "the negated block must not supply User");
        assert!(secret.user_inferred);
    }

    #[test]
    fn reports_what_it_skipped_and_why() {
        let (h, skipped) = parse(
            "Include ~/.ssh/conf.d/*\n\nHost *.internal\n  User ops\n\nMatch exec \"true\"\n  User m\n\nHost real\n",
            "local",
        );
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].alias, "real");
        let reasons: Vec<_> = skipped.iter().map(|s| s.reason).collect();
        assert!(reasons.contains(&SkipReason::Include));
        assert!(reasons.contains(&SkipReason::Wildcard));
        assert!(reasons.contains(&SkipReason::MatchBlock));
    }

    #[test]
    fn a_match_block_never_contributes_values() {
        let h = hosts("Host web\n  HostName 10.0.0.5\n\nMatch host web\n  User sneaky\n");
        assert_eq!(h[0].user, "local");
    }

    #[test]
    fn accepts_equals_and_quotes() {
        let h = hosts("Host=web\n  HostName=\"10.0.0.5\"\n  User = deploy\n");
        assert_eq!(h[0].host_name, "10.0.0.5");
        assert_eq!(h[0].user, "deploy");
    }

    #[test]
    fn keywords_are_case_insensitive() {
        let h = hosts("HOST web\n  hostname 10.0.0.5\n  USER deploy\n");
        assert_eq!(h[0].host_name, "10.0.0.5");
        assert_eq!(h[0].user, "deploy");
    }

    #[test]
    fn full_line_comments_only() {
        let h = hosts("# Host commented\nHost web\n  HostName 10.0.0.5\n");
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].alias, "web");
    }

    #[test]
    fn carries_proxy_jump_as_a_warning_not_a_feature() {
        let h = hosts("Host inner\n  HostName 10.0.0.9\n  ProxyJump bastion\n");
        assert_eq!(h[0].proxy_jump.as_deref(), Some("bastion"));
    }

    #[test]
    fn the_same_alias_twice_is_one_host() {
        let h = hosts("Host web\n  User deploy\n\nHost web\n  Port 2222\n");
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].user, "deploy");
        assert_eq!(h[0].port, 2222, "later blocks still fill in what the first left out");
    }

    #[test]
    fn globs_match_the_way_ssh_patterns_do() {
        assert!(glob_match("*.internal", "db.internal"));
        assert!(!glob_match("*.internal", "db.example.com"));
        assert!(glob_match("web-?", "web-1"));
        assert!(!glob_match("web-?", "web-12"));
        assert!(glob_match("*", "anything"));
    }

    #[test]
    fn an_empty_file_yields_nothing_rather_than_erroring() {
        let (h, s) = parse("", "local");
        assert!(h.is_empty());
        assert!(s.is_empty());
    }
}

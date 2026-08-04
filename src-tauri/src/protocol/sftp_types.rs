use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    /// Modified time in unix ms; None if the server didn't provide it.
    pub modified: Option<i64>,
    /// POSIX mode bits (0o755 etc.); 0 if unavailable.
    pub permissions: u32,
}

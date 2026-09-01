//! Command history for the terminal's inline suggestions.

use crate::error::Result;
use crate::store::command_history::CommandHistoryStore;
use serde::Deserialize;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordArgs {
    /// Saved-host id, or "adhoc" for quick-connect sessions.
    pub host_key: String,
    pub command: String,
}

#[tauri::command]
pub async fn history_record(
    args: RecordArgs,
    store: State<'_, CommandHistoryStore>,
) -> Result<()> {
    store.record(&args.host_key, &args.command).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestArgs {
    pub host_key: String,
    pub prefix: String,
}

#[tauri::command]
pub async fn history_suggest(
    args: SuggestArgs,
    store: State<'_, CommandHistoryStore>,
) -> Result<Vec<String>> {
    store.suggest(&args.host_key, &args.prefix, 8).await
}

/// Settings → Advanced escape hatch: forget every recorded command.
#[tauri::command]
pub async fn history_clear(store: State<'_, CommandHistoryStore>) -> Result<usize> {
    store.clear().await
}

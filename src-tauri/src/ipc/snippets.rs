//! Command snippets: the user's saved command library.

use crate::error::Result;
use crate::store::snippets::{NewSnippet, Snippet, SnippetStore, SnippetUpdate};
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn snippet_list(store: State<'_, SnippetStore>) -> Result<Vec<Snippet>> {
    store.list().await
}

#[tauri::command]
pub async fn snippet_save(
    args: NewSnippet,
    store: State<'_, SnippetStore>,
) -> Result<Snippet> {
    store.insert(args).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateArgs {
    pub id: Uuid,
    #[serde(flatten)]
    pub update: SnippetUpdate,
}

#[tauri::command]
pub async fn snippet_update(
    args: UpdateArgs,
    store: State<'_, SnippetStore>,
) -> Result<()> {
    store.update(args.id, args.update).await
}

#[derive(Deserialize)]
pub struct IdArgs {
    pub id: Uuid,
}

#[tauri::command]
pub async fn snippet_delete(args: IdArgs, store: State<'_, SnippetStore>) -> Result<()> {
    store.delete(args.id).await
}

import { invoke } from "@tauri-apps/api/core";
import type { NewSnippet, Snippet } from "../types/snippets";

export const snippetList = () => invoke<Snippet[]>("snippet_list");

export const snippetSave = (args: NewSnippet) =>
  invoke<Snippet>("snippet_save", { args });

export const snippetUpdate = (id: string, update: Partial<NewSnippet>) =>
  invoke<void>("snippet_update", { args: { id, ...update } });

export const snippetDelete = (id: string) =>
  invoke<void>("snippet_delete", { args: { id } });

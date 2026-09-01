import { invoke } from "@tauri-apps/api/core";

/** Records one executed command for the terminal's inline suggestions.
 *  Best-effort: never awaited on the critical path, never surfaced. */
export const historyRecord = (hostKey: string, command: string) =>
  invoke<void>("history_record", { args: { hostKey, command } });

/** Commands starting with `prefix`, best first (this host's history
 *  outranks other hosts', then use count, then recency). */
export const historySuggest = (hostKey: string, prefix: string) =>
  invoke<string[]>("history_suggest", { args: { hostKey, prefix } });

/** Forgets every recorded command. */
export const historyClear = () => invoke<number>("history_clear");

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface EditInfo {
  id: string;
  connId: string;
  name: string;
  remotePath: string;
}

/** Download a remote file to a temp copy, open it in the editor, and start
 *  watching for saves. `editor` empty → OS default program. */
export const editOpen = (connId: string, remotePath: string, editor?: string): Promise<EditInfo> =>
  invoke<EditInfo>("edit_open", { args: { conn_id: connId, remote_path: remotePath, editor: editor || null } });

/** Stop watching + upload; deletes the temp copy. */
export const editStop = (id: string): Promise<void> =>
  invoke<void>("edit_stop", { args: { id } });

export const onEditUploaded = (h: (e: { id: string; at: number }) => void): Promise<UnlistenFn> =>
  listen<{ id: string; at: number }>("edit:uploaded", (ev) => h(ev.payload));

export const onEditFailed = (h: (e: { id: string; error: string }) => void): Promise<UnlistenFn> =>
  listen<{ id: string; error: string }>("edit:failed", (ev) => h(ev.payload));

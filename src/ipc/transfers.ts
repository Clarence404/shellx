import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TransferId, TransferInfo, TransferState } from "../types/sftp";

/** Several loose files dropped in one gesture share one of these, so the
 *  strip shows the batch as a single row — exactly like a directory drop.
 *  Minted on the frontend (`newGesture`) because only the drop handler
 *  knows which files arrived together. */
export interface GestureGroup {
  groupId: string;
  groupLabel: string;
}

export const newGesture = (label: string): GestureGroup => ({
  groupId: crypto.randomUUID(),
  groupLabel: label,
});

export const sftpUpload = (conn_id: string, local_path: string, remote_path: string, group?: GestureGroup) =>
  invoke<TransferId>("sftp_upload", { args: {
    conn_id, local_path, remote_path,
    group_id: group?.groupId ?? null, group_label: group?.groupLabel ?? null,
  } });

export const sftpDownload = (conn_id: string, remote_path: string, local_path: string, group?: GestureGroup) =>
  invoke<TransferId>("sftp_download", { args: {
    conn_id, remote_path, local_path,
    group_id: group?.groupId ?? null, group_label: group?.groupLabel ?? null,
  } });

/** Backend response shape for `sftp_upload_dir` / `sftp_download_dir`.
 *  The frontend uses `groupId` to correlate the per-file `transfer:started`
 *  events that follow (each child's `TransferInfo.groupId` matches). */
export interface DirTransferInit {
  groupId: TransferId;
  transferIds: TransferId[];
  fileCount: number;
  totalBytes: number;
}

export const sftpUploadDir = (conn_id: string, local_dir: string, remote_dir: string) =>
  invoke<DirTransferInit>("sftp_upload_dir", { args: { conn_id, local_dir, remote_dir } });

export const sftpDownloadDir = (conn_id: string, remote_dir: string, local_dir: string) =>
  invoke<DirTransferInit>("sftp_download_dir", { args: { conn_id, remote_dir, local_dir } });

export const transferList = () => invoke<TransferInfo[]>("transfer_list");

export const transferCancel = (transfer_id: string) =>
  invoke<void>("transfer_cancel", { args: { transfer_id } });

/** Cancels every child of a directory transfer AND flags the group so
 *  `sftp_upload_dir` / `sftp_download_dir`'s enumeration loop stops
 *  spawning further children mid-walk. Replaces the previous
 *  N-per-child JS loop, which couldn't stop children the Rust side
 *  hadn't spawned yet — a 2500-file directory kept adding queued
 *  entries after the click. */
export const transferCancelGroup = (group_id: string) =>
  invoke<void>("transfer_cancel_group", { args: { group_id } });

/** Forgets a finished / failed / cancelled transfer on the Rust side,
 *  so a dismissed row does not come back on the next list load. */
export const transferRemove = (transfer_id: string) =>
  invoke<void>("transfer_remove", { args: { transfer_id } });

/** Queues a failed transfer again with the same endpoints; Rust
 *  re-derives which protocol carries it. Returns the new id. */
export const transferRetry = (transferId: string) =>
  invoke<string>("transfer_retry", { args: { transferId } });

/** One IPC call for the whole queue (optionally one connection's) —
 *  the per-id path meant one call per file, and twenty thousand files
 *  meant twenty thousand calls. */
export const transferPauseAll = (connId?: string, groupId?: string) =>
  invoke<number>("transfer_pause_all", { args: { conn_id: connId ?? null, group_id: groupId ?? null } });

export const transferResumeAll = (connId?: string, groupId?: string) =>
  invoke<number>("transfer_resume_all", { args: { conn_id: connId ?? null, group_id: groupId ?? null } });

export const transferCancelAll = (connId?: string, groupId?: string) =>
  invoke<number>("transfer_cancel_all", { args: { conn_id: connId ?? null, group_id: groupId ?? null } });

/** Requeues every failed member of a gesture — one IPC call, however
 *  many files failed. */
export const transferRetryGroup = (groupId: string) =>
  invoke<number>("transfer_retry_group", { args: { groupId } });

/** Forgets every finished / failed / cancelled member of a gesture. */
export const transferRemoveGroup = (groupId: string) =>
  invoke<number>("transfer_remove_group", { args: { group_id: groupId } });

export const transferPause = (transfer_id: string) =>
  invoke<void>("transfer_pause", { args: { transfer_id } });

export const transferResume = (transfer_id: string) =>
  invoke<void>("transfer_resume", { args: { transfer_id } });

export interface TransferProgressEvent {
  transfer_id: string;
  bytes_done: number;
  total_bytes: number;
  rate_bps: number;
}

export interface TransferDoneEvent {
  transfer_id: string;
  state: TransferState;
}

export const onTransferStarted = (h: (info: TransferInfo) => void): Promise<UnlistenFn> =>
  listen<TransferInfo>("transfer:started", (ev) => h(ev.payload));

export const onTransferProgress = (h: (e: TransferProgressEvent) => void): Promise<UnlistenFn> =>
  listen<TransferProgressEvent>("transfer:progress", (ev) => h(ev.payload));

export const onTransferDone = (h: (e: TransferDoneEvent) => void): Promise<UnlistenFn> =>
  listen<TransferDoneEvent>("transfer:done", (ev) => h(ev.payload));

/** Emitted when a transfer's state flips independent of progress (pause
 *  / resume). The frontend applies it via `useTransfersStore.applyState`
 *  so paused rows show a paused chip even while no bytes move. */
export interface TransferStateEvent {
  transfer_id: string;
  state: TransferState;
}

export const onTransferState = (h: (e: TransferStateEvent) => void): Promise<UnlistenFn> =>
  listen<TransferStateEvent>("transfer:state", (ev) => h(ev.payload));

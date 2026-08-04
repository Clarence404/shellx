import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TransferId, TransferInfo, TransferState } from "../types/sftp";

export const sftpUpload = (conn_id: string, local_path: string, remote_path: string) =>
  invoke<TransferId>("sftp_upload", { args: { conn_id, local_path, remote_path } });

export const sftpDownload = (conn_id: string, remote_path: string, local_path: string) =>
  invoke<TransferId>("sftp_download", { args: { conn_id, remote_path, local_path } });

export const transferList = () => invoke<TransferInfo[]>("transfer_list");

export const transferCancel = (transfer_id: string) =>
  invoke<void>("transfer_cancel", { args: { transfer_id } });

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

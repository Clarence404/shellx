import { invoke } from "@tauri-apps/api/core";
import type { SftpEntry } from "../types/sftp";

export const sftpListDir = (conn_id: string, path: string) =>
  invoke<SftpEntry[]>("sftp_list_dir", { args: { conn_id, path } });

export const sftpStat = (conn_id: string, path: string) =>
  invoke<SftpEntry>("sftp_stat", { args: { conn_id, path } });

export const sftpRename = (conn_id: string, from: string, to: string) =>
  invoke<void>("sftp_rename", { args: { conn_id, from, to } });

export const sftpRemoveFile = (conn_id: string, path: string) =>
  invoke<void>("sftp_remove_file", { args: { conn_id, path } });

export const sftpRemoveDir = (conn_id: string, path: string) =>
  invoke<void>("sftp_remove_dir", { args: { conn_id, path } });

/** Recursive counterpart. RemotePane's onDelete for directories uses
 *  this so freshly-uploaded folders (which contain files) can be
 *  removed. Backing Rust walks the tree and removes bottom-up. */
export const sftpRemoveDirRecursive = (conn_id: string, path: string) =>
  invoke<void>("sftp_remove_dir_recursive", { args: { conn_id, path } });

export const sftpMkdir = (conn_id: string, path: string) =>
  invoke<void>("sftp_mkdir", { args: { conn_id, path } });

export const sftpRealpath = (conn_id: string, path: string) =>
  invoke<string>("sftp_realpath", { args: { conn_id, path } });

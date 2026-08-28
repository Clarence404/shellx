import { invoke } from "@tauri-apps/api/core";
import type { DirTransferInit } from "./transfers";
import type {
  FtpConnected, FtpEntry, FtpHost, FtpHostSaveResult,
  SaveFtpHostArgs, UpdateFtpHostArgs,
} from "../types/ftp";

export const ftpHostList = () => invoke<FtpHost[]>("ftp_host_list");

export const ftpHostSave = (args: SaveFtpHostArgs) =>
  invoke<FtpHostSaveResult>("ftp_host_save", { args });

export const ftpHostUpdate = (args: UpdateFtpHostArgs) =>
  invoke<FtpHostSaveResult>("ftp_host_update", { args });

export const ftpHostDelete = (id: string) =>
  invoke<void>("ftp_host_delete", { args: { id } });

/** Copies saved SSH hosts in as SFTP rows. Their keychain secrets are
 *  moved across on the Rust side, so nothing passes through here. */
export const ftpHostImport = (hostIds: string[]) =>
  invoke<FtpHost[]>("ftp_host_import", { args: { hostIds } });

export const ftpConnect = (id: string, password?: string) =>
  invoke<FtpConnected>("ftp_connect", { args: { id, password: password ?? null } });

export const ftpDisconnect = (id: string) =>
  invoke<void>("ftp_disconnect", { args: { id } });

export const ftpActiveIds = () => invoke<string[]>("ftp_active_ids");

export const ftpListDir = (id: string, path: string) =>
  invoke<FtpEntry[]>("ftp_list_dir", { args: { id, path } });

export const ftpPwd = (id: string) => invoke<string>("ftp_pwd", { args: { id } });

export const ftpMkdir = (id: string, path: string) =>
  invoke<void>("ftp_mkdir", { args: { id, path } });

export const ftpRename = (id: string, from: string, to: string) =>
  invoke<void>("ftp_rename", { args: { id, from, to } });

export const ftpRemove = (id: string, path: string, isDir: boolean) =>
  invoke<void>("ftp_remove", { args: { id, path, isDir } });

/** Transfers land in the same queue the Files view uses — same events,
 *  same strip, same pause / resume / cancel. */
export const ftpUpload = (id: string, localPath: string, remotePath: string) =>
  invoke<string>("ftp_upload", { args: { id, localPath, remotePath } });

export const ftpDownload = (id: string, remotePath: string, localPath: string) =>
  invoke<string>("ftp_download", { args: { id, localPath, remotePath } });

export const ftpUploadDir = (id: string, localDir: string, remoteDir: string) =>
  invoke<DirTransferInit>("ftp_upload_dir", { args: { id, localDir, remoteDir } });

export const ftpDownloadDir = (id: string, remoteDir: string, localDir: string) =>
  invoke<DirTransferInit>("ftp_download_dir", { args: { id, localDir, remoteDir } });

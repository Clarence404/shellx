import type { SftpEntry } from "./sftp";

/** What the FTP view can speak. Only `ftp` connects in this build. */
export type FtpProtocol = "sftp" | "ftp" | "ftps";

/** Filename encoding. Meaningless for SFTP, which fixes filenames as
 *  UTF-8 — the form drops the field rather than disabling it. */
export type FtpCharset = "auto" | "utf8" | "gbk";

export interface FtpHost {
  id: string;
  label: string;
  protocol: FtpProtocol;
  host: string;
  port: number;
  username: string;
  charset: FtpCharset;
  passive: boolean;
  created_at: number;
  sort_order: number;
}

export interface SaveFtpHostArgs {
  label: string;
  protocol: FtpProtocol;
  host: string;
  port: number;
  username: string;
  charset?: FtpCharset;
  passive?: boolean;
  /** Goes to the OS keychain, never to the database. */
  password?: string;
}

export interface UpdateFtpHostArgs extends Partial<Omit<SaveFtpHostArgs, "password">> {
  id: string;
  password?: string;
}

export interface FtpHostSaveResult extends FtpHost {
  password_stored: boolean;
}

export interface FtpConnected {
  id: string;
  /** Where the server dropped us — where the pane opens. */
  cwd: string;
}

export type FtpEntry = SftpEntry;

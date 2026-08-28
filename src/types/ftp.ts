import type { SftpEntry } from "./sftp";

/** What the FTP view can speak. Only `ftp` connects in this build. */
export type FtpProtocol = "sftp" | "ftp" | "ftps";

/** Filename encoding. Meaningless for SFTP, which fixes filenames as
 *  UTF-8 — the form drops the field rather than disabling it. */
export type FtpCharset = "auto" | "utf8" | "gbk";

/** SFTP only. FTP has no key authentication, and FTPS uses TLS
 *  certificates rather than SSH keys. */
export type FtpAuthMethod = "password" | "publickey";

/** FTPS only, and not detectable: the two look the same until one of
 *  them fails, so the user picks and the error names the other. */
export type FtpTlsMode = "explicit" | "implicit";

export interface FtpHost {
  id: string;
  label: string;
  protocol: FtpProtocol;
  host: string;
  port: number;
  username: string;
  charset: FtpCharset;
  passive: boolean;
  auth_method: FtpAuthMethod;
  key_path: string | null;
  tls_mode: FtpTlsMode;
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
  auth_method?: FtpAuthMethod;
  key_path?: string | null;
  tls_mode?: FtpTlsMode;
  /** Goes to the OS keychain, never to the database. */
  password?: string;
  /** Likewise, for an encrypted private key. */
  passphrase?: string;
}

export interface UpdateFtpHostArgs
  extends Partial<Omit<SaveFtpHostArgs, "password" | "passphrase">> {
  id: string;
  password?: string;
  passphrase?: string;
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

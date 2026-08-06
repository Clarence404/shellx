export type EntryKind = "directory" | "file" | "symlink" | "other";

export interface SftpEntry {
  name: string;
  kind: EntryKind;
  size: number;
  modified: number | null;
  permissions: number;
}

export type TransferDirection = "upload" | "download";
export type TransferId = string;

export type TransferState =
  | { kind: "queued" }
  | { kind: "active" }
  | { kind: "paused" }
  | { kind: "done" }
  | { kind: "cancelled" }
  | { kind: "failed"; error: string };

export interface TransferInfo {
  id: TransferId;
  connection_id: string;
  direction: TransferDirection;
  local_path: string;
  remote_path: string;
  total_bytes: number;
  bytes_done: number;
  state: TransferState;
  started_at: number;
  /** Set when this transfer is one of N children spawned by a directory
   * upload / download (v0.6 T1). Frontend groups children by this id so
   * the Transfers view can render them under one expandable parent row.
   * Single-file transfers leave this undefined. */
  groupId?: TransferId;
}

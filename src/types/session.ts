export type SessionId = string;
export type SessionKind = "ssh";

export interface SessionInfo {
  id: SessionId;
  label: string;
  kind: SessionKind;
  host_id: string | null;
}

export interface OpenSshArgs {
  host: string;
  port: number;
  username: string;
  password: string;
  label: string;
  host_id?: string;
}

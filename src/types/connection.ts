export type ConnectionId = string;
export type ActivityKind = "terminal" | "files";

export interface ConnectionInfo {
  id: ConnectionId;
  label: string;
  kind: "ssh";
  host_id: string | null;
  state: "active" | "closed";
}

export interface OpenConnectionArgs {
  host: string;
  port: number;
  username: string;
  password: string;
  label: string;
  host_id?: string;
}

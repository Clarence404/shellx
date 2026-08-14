export type ConnectionId = string;
export type Uuid = string;
export type ActivityKind = "terminal" | "files" | "tunnel" | "monitor";

export interface ConnectionInfo {
  id: ConnectionId;
  label: string;
  kind: "ssh" | "local";
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
  // v0.8 auth fields
  auth_method?: string;   // "password" | "publickey"
  key_path?: string;
  passphrase?: string;
  // v0.9 tunnel connection mode
  connection_mode?: string;  // "terminal_only" | "term_tunnels" | "tunnels_only"
}

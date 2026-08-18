export interface TunnelRule {
  id: string;
  host_id: string;
  label: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  enabled: boolean;
  bind_all: boolean;
  auto_reconnect: boolean;
  autostart: boolean;
  sort_order: number;
  created_at: number;
}

export interface TunnelStatus {
  rule_id: string;
  session_id: string;
  status: "active" | "error" | "closed";
  error?: string;
  // session_only rules are not in DB; they disappear on disconnect.
  session_only?: boolean;
  // Metadata for display (present on session_only rules, otherwise read from TunnelRule).
  label?: string;
  local_port?: number;
  remote_host?: string;
  remote_port?: number;
}

export interface SessionTunnelInfo {
  rule_id: string;
  session_id: string;
  label: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  session_only: true;
}

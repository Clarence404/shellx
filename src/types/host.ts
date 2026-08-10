export interface HostInfo {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  notes: string | null;
  created_at: number;
  last_connected_at: number | null;
  sort_order: number;
  auth_method: string;   // "password" | "publickey"
  key_path: string | null;
  connection_mode: string;  // "terminal_only" | "term_tunnels" | "tunnels_only"
}

export interface SaveHostArgs {
  label: string;
  host: string;
  port: number;
  username: string;
  notes?: string;
  password?: string;
  auth_method?: string;
  key_path?: string | null;
  passphrase?: string;
  connection_mode?: string;
}

export interface UpdateHostArgs {
  id: string;
  label?: string;
  host?: string;
  port?: number;
  username?: string;
  notes?: string | null;
  password?: string | null; // null = delete keychain entry
  auth_method?: string;
  key_path?: string | null;
  passphrase?: string | null;
  connection_mode?: string;
}

// Response for save_host/update_host: the saved/updated host plus whether the
// intended keychain write (set/delete/unchanged) actually succeeded.
export interface HostSaveResult extends HostInfo {
  password_stored: boolean;
}

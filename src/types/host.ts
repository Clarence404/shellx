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
}

export interface SaveHostArgs {
  label: string;
  host: string;
  port: number;
  username: string;
  notes?: string;
  password?: string;
}

export interface UpdateHostArgs {
  id: string;
  label?: string;
  host?: string;
  port?: number;
  username?: string;
  notes?: string | null;
  password?: string | null; // null = delete keychain entry
}

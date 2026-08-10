CREATE TABLE IF NOT EXISTS hosts (
  id                 TEXT PRIMARY KEY NOT NULL,
  label              TEXT NOT NULL,
  host               TEXT NOT NULL,
  port               INTEGER NOT NULL DEFAULT 22,
  username           TEXT NOT NULL,
  notes              TEXT,
  created_at         INTEGER NOT NULL,
  last_connected_at  INTEGER,
  sort_order         INTEGER NOT NULL,
  auth_method        TEXT NOT NULL DEFAULT 'password',
  key_path           TEXT
);

CREATE INDEX IF NOT EXISTS idx_hosts_sort_order ON hosts(sort_order);

CREATE TABLE IF NOT EXISTS tunnels (
  id          TEXT PRIMARY KEY NOT NULL,
  host_id     TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  local_port  INTEGER NOT NULL,
  remote_host TEXT NOT NULL,
  remote_port INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  bind_all    INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tunnels_host_id ON tunnels(host_id);

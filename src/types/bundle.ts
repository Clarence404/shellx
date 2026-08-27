/** One host inside a bundle, as the import preview offers it. */
export interface BundleHostRow {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  notes: string | null;
  authMethod: string;
  keyPath: string | null;
  connectionMode: string;
  /** A password existed on the exporting machine — never the password. */
  hasPassword: boolean;
  hasPassphrase: boolean;
  tunnelCount: number;
  /** The same address is already saved here. */
  duplicate: boolean;
}

export interface BundlePreview {
  path: string;
  appVersion: string;
  exportedAt: number;
  rows: BundleHostRow[];
  tunnels: number;
  hasSettings: boolean;
}

export interface ExportSummary {
  path: string;
  hosts: number;
  tunnels: number;
  settingsIncluded: boolean;
  secretsLeftBehind: number;
}

export interface ImportSummary {
  hostsAdded: number;
  tunnelsAdded: number;
  settingsApplied: boolean;
  failures: string[];
}

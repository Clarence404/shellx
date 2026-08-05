import type { EntryKind } from "./sftp";

export interface LocalEntry {
  name: string;
  kind: EntryKind;
  size: number;
  modified: number | null;
  permissions: number;
}

export interface DefaultRoots {
  home: string;
  desktop: string;
  downloads: string;
}

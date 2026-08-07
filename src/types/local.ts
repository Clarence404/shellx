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

export interface LocalDisk {
  /** Path to navigate to on select — `C:/`, `/`, `/Volumes/Foo`, ... */
  path: string;
  /** Short label — drive letter on Windows, basename on POSIX, `/` for root. */
  label: string;
}

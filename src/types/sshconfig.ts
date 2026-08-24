/** Why an entry in `~/.ssh/config` isn't offered for import. */
export type SkipReason = "wildcard" | "negated" | "matchBlock" | "include";

export interface SkippedEntry {
  pattern: string;
  reason: SkipReason;
}

/** One importable machine, with every ssh_config value already resolved. */
export interface ConfigHost {
  alias: string;
  hostName: string;
  user: string;
  /** True when no `User` applied and the local account name was guessed. */
  userInferred: boolean;
  port: number;
  identityFile: string | null;
  /** Present only so the UI can warn — shellx does not set up jump hosts. */
  proxyJump: string | null;
}

export interface SshConfigScan {
  path: string;
  exists: boolean;
  hosts: ConfigHost[];
  skipped: SkippedEntry[];
}

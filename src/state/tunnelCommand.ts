/** The parts of a tunnel rule and its host that a command needs. */
export interface TunnelCommandInput {
  bindAll: boolean;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  /** SSH user on the jump host. */
  username: string;
  /** The jump host's address. */
  host: string;
  /** Its SSH port; 22 is left out of the command. */
  port: number;
  /** Private key for this host, when it authenticates with one. Null for
   *  password auth, where ssh prompts instead. */
  keyPath?: string | null;
}

/** Wrap a path in double quotes when it has whitespace in it — a key
 *  under `C:\Users\First Last\.ssh` is common enough on Windows that an
 *  unquoted command would fail for an unobvious reason. */
function quoteArg(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/** `0.0.0.0:15432` — what a database client's host/port field wants. */
export function localAddress(input: Pick<TunnelCommandInput, "bindAll" | "localPort">): string {
  return `${input.bindAll ? "0.0.0.0" : "127.0.0.1"}:${input.localPort}`;
}

/**
 * The `ssh -L` command that reproduces this tunnel outside shellx.
 *
 * Shaped so the Tunnels view's own import can parse it back: the bind
 * address is included only when the rule binds all interfaces, which is
 * exactly the 4-part form `parseSSHImport` understands (and the 3-part
 * form otherwise). No `-N`: it forwards just as well, but the terminal
 * then sits blank with no prompt and no output, which reads as a hung
 * command. Letting ssh open its shell gives the forward somewhere
 * visible to live and an obvious way to end it. The host's key file is
 * named with `-i` when it has one; without it ssh falls back to whatever
 * is in `~/.ssh`, which is rarely the key shellx was using.
 */
export function sshCommand(input: TunnelCommandInput): string {
  const bind = input.bindAll ? "0.0.0.0:" : "";
  const forward = `${bind}${input.localPort}:${input.remoteHost}:${input.remotePort}`;
  // Port 22 is the default; naming it adds noise to every command.
  const port = input.port && input.port !== 22 ? ` -p ${input.port}` : "";
  const key = input.keyPath?.trim() ? ` -i ${quoteArg(input.keyPath.trim())}` : "";
  return `ssh -L ${forward}${port}${key} ${input.username}@${input.host}`;
}

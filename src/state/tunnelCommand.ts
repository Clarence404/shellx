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
 * form otherwise). `-N` because the command forwards and nothing else —
 * without it ssh also opens a shell nobody asked for.
 */
export function sshCommand(input: TunnelCommandInput): string {
  const bind = input.bindAll ? "0.0.0.0:" : "";
  const forward = `${bind}${input.localPort}:${input.remoteHost}:${input.remotePort}`;
  // Port 22 is the default; naming it adds noise to every command.
  const port = input.port && input.port !== 22 ? ` -p ${input.port}` : "";
  return `ssh -N -L ${forward}${port} ${input.username}@${input.host}`;
}

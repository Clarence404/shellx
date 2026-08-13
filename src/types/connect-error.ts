import type { HostInfo } from "./host";

export type ConnectError =
  | { kind: "passphrase-needed" }
  | { kind: "key-rejected"; detail: string }
  | { kind: "hostkey-declined" }
  | { kind: "other"; message: string };

export function parseConnectError(e: unknown): ConnectError {
  const msg = String(e);
  if (msg === "passphrase-needed" || msg.startsWith("passphrase-needed"))
    return { kind: "passphrase-needed" };
  if (msg.startsWith("key-rejected"))
    return { kind: "key-rejected", detail: msg.replace(/^key-rejected:\s*/, "") };
  if (msg === "hostkey-declined" || msg.startsWith("hostkey-declined"))
    return { kind: "hostkey-declined" };
  return { kind: "other", message: msg };
}

export interface PassphraseReq {
  host: HostInfo;
  attempt: number;
  error: string | null;
}

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface HostkeyChallenge {
  attemptId: string;
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  verdict: "unknown" | "mismatch";
  storedFingerprint: string | null;
}

export interface TrustedHost {
  host: string;
  key_type: string;
  fingerprint: string;
}

export const hostkeyRespond = (attemptId: string, accept: boolean): Promise<void> =>
  invoke<void>("hostkey_respond", { args: { attemptId, accept } });

export const hostkeysList = (): Promise<TrustedHost[]> =>
  invoke<TrustedHost[]>("hostkeys_list");

export const onHostkeyChallenge = (
  handler: (e: HostkeyChallenge) => void
): Promise<UnlistenFn> =>
  listen<HostkeyChallenge>("hostkey:challenge", (ev) => handler(ev.payload));

import { invoke } from "@tauri-apps/api/core";

export interface DiscoveredKey {
  path: string;
  fileName: string;
  kind: "supported" | "ppk" | "ssh2";
  algo: string | null;
  comment: string | null;
  encrypted: boolean;
}

export const keysDiscover = (): Promise<DiscoveredKey[]> =>
  invoke<DiscoveredKey[]>("keys_discover");

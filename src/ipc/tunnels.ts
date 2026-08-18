import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TunnelRule, TunnelStatus, SessionTunnelInfo } from "../types/tunnel";
import type { Uuid } from "../types/connection";

export async function listTunnelsForHost(host_id: Uuid): Promise<TunnelRule[]> {
  return invoke("tunnel_list_for_host", { hostId: host_id });
}

export async function addTunnel(rule: {
  host_id: Uuid;
  label: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  enabled?: boolean;
  bind_all?: boolean;
}): Promise<TunnelRule> {
  return invoke("tunnel_add", { rule });
}

export async function updateTunnel(rule: {
  id: Uuid;
  host_id?: Uuid;
  label?: string;
  local_port?: number;
  remote_host?: string;
  remote_port?: number;
  enabled?: boolean;
  bind_all?: boolean;
  sort_order?: number;
}): Promise<void> {
  return invoke("tunnel_update", { rule });
}

export async function deleteTunnel(id: Uuid): Promise<void> {
  return invoke("tunnel_delete", { args: { id } });
}

export async function openTunnel(args: {
  session_id: Uuid;
  rule_id: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  bind_all?: boolean;
}): Promise<void> {
  return invoke("tunnel_open", { args });
}

/** Open a tunnel through a saved host regardless of whether there's an
 *  interactive terminal session for it. Backend reuses an existing SSH
 *  handshake or opens a fresh "silent" transport using stored credentials.
 *  Returns { session_id, reused_session } so the caller can address later
 *  tunnel:status events and closeTunnel calls. */
export async function openTunnelViaHost(args: {
  host_id: Uuid;
  rule_id: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  bind_all?: boolean;
}): Promise<{ session_id: Uuid; reused_session: boolean }> {
  const raw = await invoke<{ session_id: Uuid; reused_session: boolean }>(
    "tunnel_open_via_host", { args },
  );
  return raw;
}

export async function closeTunnel(session_id: Uuid, rule_id: string): Promise<void> {
  return invoke("tunnel_close", { args: { session_id, rule_id } });
}

export async function addSessionTunnel(args: {
  session_id: Uuid;
  label: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
}): Promise<SessionTunnelInfo> {
  return invoke("tunnel_add_session", { args });
}

export async function reorderTunnels(host_id: Uuid, rule_ids: Uuid[]): Promise<void> {
  return invoke("tunnel_reorder", { args: { host_id, rule_ids } });
}

export const onTunnelStatus = (h: (s: TunnelStatus) => void): Promise<UnlistenFn> =>
  listen<TunnelStatus>("tunnel:status", (ev) => h(ev.payload));

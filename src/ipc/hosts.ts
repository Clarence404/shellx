import { invoke } from "@tauri-apps/api/core";
import type { HostInfo, SaveHostArgs, UpdateHostArgs } from "../types/host";

export const listHosts = () => invoke<HostInfo[]>("list_hosts");

export const saveHost = (args: SaveHostArgs) =>
  invoke<HostInfo>("save_host", { args });

export const updateHost = (args: UpdateHostArgs) =>
  invoke<HostInfo>("update_host", { args });

export const deleteHost = (id: string) =>
  invoke<void>("delete_host", { args: { id } });

export const getHostPassword = (id: string) =>
  invoke<string | null>("get_host_password", { args: { id } });

export const keychainAvailable = () => invoke<boolean>("keychain_available");

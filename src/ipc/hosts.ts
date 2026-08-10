import { invoke } from "@tauri-apps/api/core";
import type { HostInfo, HostSaveResult, SaveHostArgs, UpdateHostArgs } from "../types/host";

export const listHosts = () => invoke<HostInfo[]>("list_hosts");

export const saveHost = (args: SaveHostArgs) =>
  invoke<HostSaveResult>("save_host", { args });

export const updateHost = (args: UpdateHostArgs) =>
  invoke<HostSaveResult>("update_host", { args });

export const deleteHost = (id: string) =>
  invoke<void>("delete_host", { args: { id } });

export const getHostPassword = (id: string) =>
  invoke<string | null>("get_host_password", { args: { id } });

export const getHostPassphrase = (id: string) =>
  invoke<string | null>("get_host_passphrase", { args: { id } });

export const setHostPassphrase = (id: string, passphrase: string) =>
  invoke<void>("set_host_passphrase", { args: { id, passphrase } });

export const keychainAvailable = () => invoke<boolean>("keychain_available");

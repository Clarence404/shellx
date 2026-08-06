import { invoke } from "@tauri-apps/api/core";
import type { LocalEntry, DefaultRoots } from "../types/local";

export const localListDir = (path: string) =>
  invoke<LocalEntry[]>("local_list_dir", { args: { path } });

export const localRealpath = (path: string) =>
  invoke<string>("local_realpath", { args: { path } });

export const localDefaultRoots = () =>
  invoke<DefaultRoots>("local_default_roots");

export const localMkdir = (path: string) =>
  invoke<void>("local_mkdir", { args: { path } });

export const localRename = (from: string, to: string) =>
  invoke<void>("local_rename", { args: { from, to } });

export const localRemoveFile = (path: string) =>
  invoke<void>("local_remove_file", { args: { path } });

export const localRemoveDir = (path: string) =>
  invoke<void>("local_remove_dir", { args: { path } });

export const localOpenInOs = (path: string) =>
  invoke<void>("local_open_in_os", { args: { path } });

export const localCopyInto = (src: string, dstDir: string) =>
  invoke<void>("local_copy_into", { args: { src, dstDir } });

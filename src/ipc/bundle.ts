import { invoke } from "@tauri-apps/api/core";
import type { BundlePreview, ExportSummary, ImportSummary } from "../types/bundle";

export const exportBundle = (path: string, includeSettings: boolean) =>
  invoke<ExportSummary>("config_bundle_export", { args: { path, includeSettings } });

export const previewBundle = (path: string) =>
  invoke<BundlePreview>("config_bundle_preview", { args: { path } });

export const importBundle = (path: string, hostIds: string[], includeSettings: boolean) =>
  invoke<ImportSummary>("config_bundle_import", {
    args: { path, hostIds, includeSettings },
  });

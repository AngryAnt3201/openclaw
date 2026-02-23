import type { KBConfig } from "./types.js";

export const DEFAULT_SYNC_FOLDER = "_miranda";

export const DEFAULT_KB_CONFIG: KBConfig = {
  enabled: false,
  provider: "obsidian",
  vaultPath: "",
  syncFolder: DEFAULT_SYNC_FOLDER,
};

export function resolveKBSyncPath(config: KBConfig): string {
  const syncFolder = config.syncFolder || DEFAULT_SYNC_FOLDER;
  return `${config.vaultPath}/${syncFolder}`;
}

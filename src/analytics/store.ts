// ---------------------------------------------------------------------------
// Analytics – File-based Store
// ---------------------------------------------------------------------------
// Follows the people/store.ts pattern: atomic writes, directory auto-creation.
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AnalyticsStoreFile } from "./types.js";

const DEFAULT_DIR = ".openclaw";

export function resolveAnalyticsStorePath(customPath?: string): string {
  if (customPath) {
    return customPath;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "analytics", "store.json");
}

export function emptyStore(): AnalyticsStoreFile {
  return {
    version: 1,
    slaProfiles: [],
    responseEntries: [],
  };
}

export async function readAnalyticsStore(storePath: string): Promise<AnalyticsStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const data = JSON.parse(raw) as AnalyticsStoreFile;
    if (data.version !== 1) {
      return emptyStore();
    }
    return data;
  } catch {
    return emptyStore();
  }
}

export async function writeAnalyticsStore(
  storePath: string,
  store: AnalyticsStoreFile,
): Promise<void> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = storePath + ".tmp." + process.pid;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, storePath);
}

// ---------------------------------------------------------------------------
// Triage – File-based Store
// ---------------------------------------------------------------------------
// Follows the people/store.ts pattern: atomic writes, directory auto-creation.
// Auto-prunes triages older than 30 days on read.
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TriageStoreFile } from "./types.js";

const DEFAULT_DIR = ".openclaw";
const PRUNE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function resolveTriageStorePath(customPath?: string): string {
  if (customPath) {
    return customPath;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "triage", "store.json");
}

export function emptyStore(): TriageStoreFile {
  return {
    version: 1,
    triages: [],
  };
}

export async function readTriageStore(storePath: string): Promise<TriageStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const data = JSON.parse(raw) as TriageStoreFile;
    if (data.version !== 1) {
      return emptyStore();
    }
    // Auto-prune: remove triages older than 30 days
    const cutoff = Date.now() - PRUNE_MAX_AGE_MS;
    data.triages = data.triages.filter((t) => t.processedAtMs >= cutoff);
    return data;
  } catch {
    return emptyStore();
  }
}

export async function writeTriageStore(storePath: string, store: TriageStoreFile): Promise<void> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = storePath + ".tmp." + process.pid;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, storePath);
}

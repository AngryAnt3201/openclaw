// ---------------------------------------------------------------------------
// People – File-based Store
// ---------------------------------------------------------------------------
// Follows the inbound/store.ts pattern: atomic writes, directory auto-creation.
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PeopleStoreFile } from "./types.js";

const DEFAULT_DIR = ".openclaw";

export function resolvePeopleStorePath(customPath?: string): string {
  if (customPath) {
    return customPath;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "people", "store.json");
}

export function emptyStore(): PeopleStoreFile {
  return {
    version: 1,
    persons: [],
    organizations: [],
    groups: [],
    suggestions: [],
  };
}

export async function readPeopleStore(storePath: string): Promise<PeopleStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const data = JSON.parse(raw) as PeopleStoreFile;
    if (data.version !== 1) {
      return emptyStore();
    }
    return data;
  } catch {
    return emptyStore();
  }
}

export async function writePeopleStore(storePath: string, store: PeopleStoreFile): Promise<void> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const tmp = storePath + ".tmp." + process.pid;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, storePath);
}

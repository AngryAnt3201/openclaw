// ---------------------------------------------------------------------------
// Project Store – File-based persistence for projects
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/projects/
//     store.json   – { version: 1, projects: Project[] }
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ProjectStoreFile } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveProjectStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "projects", "store.json");
}

// ---------------------------------------------------------------------------
// Empty factory function (returns a NEW object each time to avoid shared-ref bugs)
// ---------------------------------------------------------------------------

export function emptyStore(): ProjectStoreFile {
  return { version: 1, projects: [] };
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

async function atomicWrite(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + ".tmp";
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

export async function readProjectStore(filePath: string): Promise<ProjectStoreFile> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ProjectStoreFile;
    if (!Array.isArray(parsed.projects)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function writeProjectStore(
  filePath: string,
  data: ProjectStoreFile,
): Promise<void> {
  await atomicWrite(filePath, data);
}

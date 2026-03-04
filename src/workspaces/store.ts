// ---------------------------------------------------------------------------
// Workspace Store – File-based persistence for workspace registry
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/workspaces/
//     store.json  – { version: 1, workspaces: Workspace[] }
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WorkspaceStoreFile } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveWorkspaceStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "workspaces", "store.json");
}

// ---------------------------------------------------------------------------
// Empty factory (returns a NEW object each time to avoid shared-ref bugs)
// ---------------------------------------------------------------------------

export function emptyStore(): WorkspaceStoreFile {
  return { version: 1, workspaces: [] };
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

export async function readWorkspaceStore(filePath: string): Promise<WorkspaceStoreFile> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as WorkspaceStoreFile;
    if (!Array.isArray(parsed.workspaces)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function writeWorkspaceStore(
  filePath: string,
  data: WorkspaceStoreFile,
): Promise<void> {
  await atomicWrite(filePath, data);
}

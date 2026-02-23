// ---------------------------------------------------------------------------
// Launcher Store – File-based persistence following task store pattern
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/launcher/
//     store.json – { version: 1, apps: LaunchableApp[], discoveredApps: DiscoveredApp[] }
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LaunchableApp, LauncherStoreFile } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveLauncherStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "launcher", "store.json");
}

// ---------------------------------------------------------------------------
// Read / write store file (atomic)
// ---------------------------------------------------------------------------

function emptyStore(): LauncherStoreFile {
  return { version: 1, apps: [], discoveredApps: [] };
}

export async function readLauncherStore(storePath: string): Promise<LauncherStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as LauncherStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.apps)) {
      return emptyStore();
    }
    if (!Array.isArray(parsed.discoveredApps)) {
      parsed.discoveredApps = [];
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function writeLauncherStore(
  storePath: string,
  store: LauncherStoreFile,
): Promise<void> {
  const dir = path.dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = storePath + ".tmp";
  const content = JSON.stringify(store, null, 2);
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, storePath);
}

// ---------------------------------------------------------------------------
// One-time migration from legacy ~/.maestro-launcher.json
// ---------------------------------------------------------------------------

type LegacyApp = {
  id: string;
  name: string;
  category: string;
  icon: string;
  icon_path: string | null;
  pinned: boolean;
  pinned_order: number;
  status: string;
  last_launched_at: string | null;
  bundle_id: string | null;
  app_path: string | null;
  run_command: string | null;
  working_dir: string | null;
  port: number | null;
  session_id: number | null;
  maestro_app_id: string | null;
  url: string | null;
  tags: string[];
  color: string | null;
};

export async function migrateLegacyLauncherStore(
  storePath: string,
  nowMs?: number,
): Promise<boolean> {
  // Only migrate if new store doesn't exist
  if (existsSync(storePath)) {
    return false;
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const legacyPath = path.join(home, ".maestro-launcher.json");

  if (!existsSync(legacyPath)) {
    return false;
  }

  try {
    const raw = await fs.readFile(legacyPath, "utf-8");
    const legacyApps = JSON.parse(raw) as LegacyApp[];
    if (!Array.isArray(legacyApps)) {
      return false;
    }

    const now = nowMs ?? Date.now();
    const apps: LaunchableApp[] = legacyApps.map((app) => ({
      ...app,
      description: "",
      category: app.category as LaunchableApp["category"],
      status: (app.status as LaunchableApp["status"]) ?? "stopped",
      device_id: null,
      env_vars: null,
      health_check_url: null,
      proxy_url: null,
      createdAtMs: now,
      updatedAtMs: now,
    }));

    const store: LauncherStoreFile = { version: 1, apps, discoveredApps: [] };
    await writeLauncherStore(storePath, store);
    return true;
  } catch {
    return false;
  }
}

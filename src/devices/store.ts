// ---------------------------------------------------------------------------
// Device Store – File-based persistence following launcher store pattern
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/devices/
//     store.json – { version: 1, devices: Device[] }
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DeviceStoreFile } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveDeviceStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "devices", "store.json");
}

// ---------------------------------------------------------------------------
// Read / write store file (atomic)
// ---------------------------------------------------------------------------

function emptyStore(): DeviceStoreFile {
  return { version: 1, devices: [] };
}

export async function readDeviceStore(storePath: string): Promise<DeviceStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as DeviceStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.devices)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function writeDeviceStore(storePath: string, store: DeviceStoreFile): Promise<void> {
  const dir = path.dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = storePath + ".tmp";
  const content = JSON.stringify(store, null, 2);
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, storePath);
}

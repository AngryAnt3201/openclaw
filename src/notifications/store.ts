// ---------------------------------------------------------------------------
// Notification Store – File-based persistence (mirrors tasks/store.ts)
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/notifications/
//     store.json – { version: 1, notifications: Notification[], preferences: NotificationPreferences }
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { NotificationStoreFile, NotificationPreferences } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveNotificationStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "notifications", "store.json");
}

// ---------------------------------------------------------------------------
// Default preferences factory
// ---------------------------------------------------------------------------

export function defaultPreferences(): NotificationPreferences {
  return {
    enabled: true,
    nodePushEnabled: true,
    defaultChannels: [],
    routes: {},
    quietHours: {
      enabled: false,
      startHour: 22,
      endHour: 8,
    },
    webhooks: [],
  };
}

// ---------------------------------------------------------------------------
// Read / write store file (atomic)
// ---------------------------------------------------------------------------

function emptyStore(): NotificationStoreFile {
  return { version: 1, notifications: [], preferences: defaultPreferences() };
}

export async function readNotificationStore(storePath: string): Promise<NotificationStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as NotificationStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.notifications)) {
      return emptyStore();
    }
    // Ensure preferences always exists
    if (!parsed.preferences) {
      parsed.preferences = defaultPreferences();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function writeNotificationStore(
  storePath: string,
  store: NotificationStoreFile,
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

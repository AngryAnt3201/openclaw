// ---------------------------------------------------------------------------
// Inbound Store – File-based persistence (follows tasks/store.ts pattern)
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { InboundMessage, InboundStoreFile, SnoozeConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveInboundStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "inbound", "store.json");
}

// ---------------------------------------------------------------------------
// V1 → V2 migration
// ---------------------------------------------------------------------------

/** Status mapping from v1 to v2. */
const STATUS_V1_TO_V2: Record<string, InboundMessage["status"]> = {
  pending: "unread",
  queued: "unread",
  processing: "read",
  processed: "archived",
  failed: "flagged",
  ignored: "archived",
};

/**
 * Migrate a v1 store to v2 in place. Idempotent — already-migrated messages
 * (with v2 status values) pass through unchanged.
 */
export function migrateV1ToV2(store: Record<string, unknown>): InboundStoreFile {
  const messages = (store.messages ?? []) as Array<Record<string, unknown>>;
  const channels = (store.channels ?? []) as unknown[];
  const routes = (store.routes ?? []) as unknown[];

  for (const msg of messages) {
    const oldStatus = msg.status as string;

    // Map status (idempotent: v2 values map to themselves)
    const newStatus = STATUS_V1_TO_V2[oldStatus] ?? oldStatus;
    msg.status = newStatus;

    // Set bodyResolved from body if missing
    if (msg.bodyResolved === undefined || msg.bodyResolved === null) {
      msg.bodyResolved = msg.body ?? "";
    }

    // Set mentions if missing
    if (!Array.isArray(msg.mentions)) {
      msg.mentions = [];
    }

    // Move priority to metadata.legacyPriority
    if (msg.priority !== undefined) {
      const meta = (msg.metadata ?? {}) as Record<string, unknown>;
      if (meta.legacyPriority === undefined) {
        meta.legacyPriority = msg.priority;
      }
      msg.metadata = meta;
      delete msg.priority;
    }

    // Map processedAtMs → archivedAtMs
    if (msg.processedAtMs !== undefined) {
      if (msg.archivedAtMs === undefined) {
        msg.archivedAtMs = msg.processedAtMs;
      }
      delete msg.processedAtMs;
    }

    // Set timestamp fields based on status
    if (newStatus === "archived" && msg.archivedAtMs === undefined) {
      msg.archivedAtMs = msg.updatedAtMs;
    }
    if (newStatus === "flagged" && msg.flaggedAtMs === undefined) {
      msg.flaggedAtMs = msg.updatedAtMs;
    }
    if (newStatus === "read" && msg.readAtMs === undefined) {
      msg.readAtMs = msg.updatedAtMs;
    }

    // Remove deprecated fields
    delete msg.pendingAction;
    delete msg.result;
    delete msg.intent;
  }

  return {
    version: 2,
    messages: messages as unknown as InboundMessage[],
    channels: channels as unknown as InboundStoreFile["channels"],
    routes: routes as unknown as InboundStoreFile["routes"],
  };
}

// ---------------------------------------------------------------------------
// V2 → V3 migration
// ---------------------------------------------------------------------------

/**
 * Migrate a v2 store to v3 in place.
 * - Backfills `direction: "inbound"` on all messages
 * - Converts `snoozedUntilMs` → `snoozeConfig` (type: "time")
 * - Sets `personId: undefined` on all messages
 * - Bumps version to 3
 */
export function migrateV2ToV3(store: Record<string, unknown>): InboundStoreFile {
  const messages = (store.messages ?? []) as Array<Record<string, unknown>>;
  const channels = (store.channels ?? []) as unknown[];
  const routes = (store.routes ?? []) as unknown[];

  for (const msg of messages) {
    // Backfill direction
    if (msg.direction === undefined) {
      msg.direction = "inbound";
    }

    // Convert snoozedUntilMs → snoozeConfig
    if (msg.snoozedUntilMs !== undefined && msg.snoozeConfig === undefined) {
      const snoozeConfig: SnoozeConfig = {
        type: "time",
        untilMs: msg.snoozedUntilMs as number,
        snoozedAtMs: (msg.updatedAtMs as number) ?? Date.now(),
      };
      msg.snoozeConfig = snoozeConfig;
      // Keep snoozedUntilMs for backward compatibility — do NOT delete
    }

    // Set personId if missing
    if (msg.personId === undefined) {
      msg.personId = undefined;
    }
  }

  return {
    version: 3,
    messages: messages as unknown as InboundMessage[],
    channels: channels as unknown as InboundStoreFile["channels"],
    routes: routes as unknown as InboundStoreFile["routes"],
  };
}

// ---------------------------------------------------------------------------
// Read / write store file (atomic)
// ---------------------------------------------------------------------------

function emptyStore(): InboundStoreFile {
  return { version: 3, messages: [], channels: [], routes: [] };
}

export async function readInboundStore(storePath: string): Promise<InboundStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const version = parsed.version as number | undefined;
    if (!Array.isArray(parsed.messages)) {
      return emptyStore();
    }

    // Chain migrations: v1 → v2 → v3
    let store: Record<string, unknown> = parsed;
    let migrated = false;

    if (version === 1) {
      store = migrateV1ToV2(store) as unknown as Record<string, unknown>;
      migrated = true;
    }

    const currentVersion = (store as { version?: number }).version;

    if (currentVersion === 2) {
      store = migrateV2ToV3(store) as unknown as Record<string, unknown>;
      migrated = true;
    }

    if ((store as { version?: number }).version === 3) {
      const result = store as unknown as InboundStoreFile;
      if (migrated) {
        // Persist migration so it only runs once
        await writeInboundStore(storePath, result);
      }
      return result;
    }

    // Unknown version
    return emptyStore();
  } catch {
    return emptyStore();
  }
}

export async function writeInboundStore(storePath: string, store: InboundStoreFile): Promise<void> {
  const dir = path.dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = storePath + ".tmp";
  const content = JSON.stringify(store, null, 2);
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, storePath);
}

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { NotificationStoreFile } from "./types.js";
import {
  readNotificationStore,
  writeNotificationStore,
  resolveNotificationStorePath,
  defaultPreferences,
} from "./store.js";

let tmpDir: string;
let storePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notif-store-"));
  storePath = path.join(tmpDir, "store.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveNotificationStorePath", () => {
  it("uses custom path when provided", () => {
    const p = resolveNotificationStorePath("/custom/path/store.json");
    expect(p).toBe("/custom/path/store.json");
  });

  it("uses default path when not provided", () => {
    const p = resolveNotificationStorePath();
    expect(p).toContain("notifications");
    expect(p).toContain("store.json");
  });
});

describe("defaultPreferences", () => {
  it("returns fresh object each call", () => {
    const a = defaultPreferences();
    const b = defaultPreferences();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.defaultChannels).not.toBe(b.defaultChannels);
  });
});

describe("readNotificationStore", () => {
  it("returns empty store for missing file", async () => {
    const store = await readNotificationStore(storePath);
    expect(store.version).toBe(1);
    expect(store.notifications).toEqual([]);
    expect(store.preferences.enabled).toBe(true);
  });

  it("reads existing store", async () => {
    const existing: NotificationStoreFile = {
      version: 1,
      notifications: [
        {
          id: "n1",
          type: "system_event",
          title: "Test",
          body: "Hello",
          priority: "medium",
          status: "unread",
          channels: [],
          createdAtMs: 1000,
          updatedAtMs: 1000,
        },
      ],
      preferences: defaultPreferences(),
    };
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(existing));

    const store = await readNotificationStore(storePath);
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0]!.id).toBe("n1");
  });

  it("returns empty store for invalid JSON", async () => {
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, "not json");

    const store = await readNotificationStore(storePath);
    expect(store.notifications).toEqual([]);
  });

  it("returns empty store for wrong version", async () => {
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify({ version: 99, notifications: [] }));

    const store = await readNotificationStore(storePath);
    expect(store.notifications).toEqual([]);
  });
});

describe("writeNotificationStore", () => {
  it("creates directories and writes atomically", async () => {
    const store: NotificationStoreFile = {
      version: 1,
      notifications: [],
      preferences: defaultPreferences(),
    };

    await writeNotificationStore(storePath, store);

    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.notifications).toEqual([]);
  });

  it("overwrites existing file", async () => {
    const store1: NotificationStoreFile = {
      version: 1,
      notifications: [],
      preferences: defaultPreferences(),
    };
    await writeNotificationStore(storePath, store1);

    const store2: NotificationStoreFile = {
      version: 1,
      notifications: [
        {
          id: "n1",
          type: "custom",
          title: "Test",
          body: "Body",
          priority: "low",
          status: "unread",
          channels: [],
          createdAtMs: 1000,
          updatedAtMs: 1000,
        },
      ],
      preferences: defaultPreferences(),
    };
    await writeNotificationStore(storePath, store2);

    const result = await readNotificationStore(storePath);
    expect(result.notifications).toHaveLength(1);
  });
});

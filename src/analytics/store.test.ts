// ---------------------------------------------------------------------------
// Analytics Store – Tests
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AnalyticsStoreFile } from "./types.js";
import {
  emptyStore,
  readAnalyticsStore,
  writeAnalyticsStore,
  resolveAnalyticsStorePath,
} from "./store.js";

let tmpDir: string;
let storePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "analytics-store-"));
  storePath = path.join(tmpDir, "store.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("emptyStore", () => {
  it("returns fresh store with no shared references", () => {
    const a = emptyStore();
    const b = emptyStore();
    a.slaProfiles.push({ id: "x" } as any);
    expect(b.slaProfiles).toHaveLength(0);
  });

  it("returns store with version 1", () => {
    const store = emptyStore();
    expect(store.version).toBe(1);
    expect(store.slaProfiles).toEqual([]);
    expect(store.responseEntries).toEqual([]);
  });
});

describe("readAnalyticsStore", () => {
  it("returns empty store when file does not exist", async () => {
    const store = await readAnalyticsStore(storePath);
    expect(store.version).toBe(1);
    expect(store.slaProfiles).toHaveLength(0);
    expect(store.responseEntries).toHaveLength(0);
  });

  it("reads existing store from disk", async () => {
    const data: AnalyticsStoreFile = {
      version: 1,
      slaProfiles: [
        {
          id: "sla1",
          name: "Priority",
          targetResponseMs: 3600000,
          escalateAfterMs: 7200000,
          appliesTo: "person",
          entityIds: ["p1"],
        },
      ],
      responseEntries: [
        {
          messageId: "msg1",
          personId: "p1",
          receivedAtMs: 1000,
        },
      ],
    };
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(data));
    const store = await readAnalyticsStore(storePath);
    expect(store.slaProfiles).toHaveLength(1);
    expect(store.slaProfiles[0].name).toBe("Priority");
    expect(store.responseEntries).toHaveLength(1);
    expect(store.responseEntries[0].messageId).toBe("msg1");
  });

  it("returns empty store for unknown version", async () => {
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(
      storePath,
      JSON.stringify({ version: 99, slaProfiles: [], responseEntries: [] }),
    );
    const store = await readAnalyticsStore(storePath);
    expect(store.version).toBe(1);
    expect(store.slaProfiles).toHaveLength(0);
  });
});

describe("writeAnalyticsStore", () => {
  it("writes store atomically and can be read back", async () => {
    const store = emptyStore();
    store.slaProfiles.push({
      id: "sla1",
      name: "VIP",
      targetResponseMs: 1800000,
      escalateAfterMs: 3600000,
      appliesTo: "person",
      entityIds: ["p1"],
    });
    await writeAnalyticsStore(storePath, store);
    const read = await readAnalyticsStore(storePath);
    expect(read.slaProfiles).toHaveLength(1);
    expect(read.slaProfiles[0].name).toBe("VIP");
  });

  it("creates parent directories if missing", async () => {
    const deepPath = path.join(tmpDir, "a", "b", "store.json");
    await writeAnalyticsStore(deepPath, emptyStore());
    const read = await readAnalyticsStore(deepPath);
    expect(read.version).toBe(1);
  });
});

describe("resolveAnalyticsStorePath", () => {
  it("returns default path under home directory", () => {
    const p = resolveAnalyticsStorePath();
    expect(p).toContain("analytics");
    expect(p).toContain("store.json");
  });

  it("returns custom path when provided", () => {
    const custom = "/tmp/my-analytics/store.json";
    expect(resolveAnalyticsStorePath(custom)).toBe(custom);
  });
});

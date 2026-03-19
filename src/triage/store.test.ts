import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { MessageTriage, TriageStoreFile } from "./types.js";
import { emptyStore, readTriageStore, writeTriageStore, resolveTriageStorePath } from "./store.js";

let tmpDir: string;
let storePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "triage-store-"));
  storePath = path.join(tmpDir, "store.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeTriage(messageId: string, processedAtMs: number): MessageTriage {
  return {
    messageId,
    priorityScore: 0.5,
    priorityFactors: [],
    topics: [],
    sentiment: "neutral",
    processedAtMs,
  };
}

describe("emptyStore", () => {
  it("returns fresh store with no shared references", () => {
    const a = emptyStore();
    const b = emptyStore();
    a.triages.push(makeTriage("x", Date.now()));
    expect(b.triages).toHaveLength(0);
  });
});

describe("readTriageStore", () => {
  it("returns empty store when file does not exist", async () => {
    const store = await readTriageStore(storePath);
    expect(store.version).toBe(1);
    expect(store.triages).toHaveLength(0);
  });

  it("reads existing store from disk", async () => {
    const data: TriageStoreFile = {
      version: 1,
      triages: [makeTriage("msg-1", Date.now())],
    };
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(data));
    const store = await readTriageStore(storePath);
    expect(store.triages).toHaveLength(1);
    expect(store.triages[0].messageId).toBe("msg-1");
  });
});

describe("writeTriageStore", () => {
  it("writes store atomically and can be read back", async () => {
    const store = emptyStore();
    store.triages.push(makeTriage("msg-2", Date.now()));
    await writeTriageStore(storePath, store);
    const read = await readTriageStore(storePath);
    expect(read.triages).toHaveLength(1);
    expect(read.triages[0].messageId).toBe("msg-2");
  });

  it("creates parent directories if missing", async () => {
    const deepPath = path.join(tmpDir, "a", "b", "store.json");
    await writeTriageStore(deepPath, emptyStore());
    const read = await readTriageStore(deepPath);
    expect(read.version).toBe(1);
  });
});

describe("resolveTriageStorePath", () => {
  it("returns path containing 'triage'", () => {
    const p = resolveTriageStorePath();
    expect(p).toContain("triage");
    expect(p).toContain("store.json");
  });
});

describe("auto-prune", () => {
  it("removes triages older than 30 days on read", async () => {
    const oldMs = Date.now() - 31 * 24 * 60 * 60 * 1000; // 31 days ago
    const data: TriageStoreFile = {
      version: 1,
      triages: [makeTriage("old-msg", oldMs)],
    };
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(data));
    const store = await readTriageStore(storePath);
    expect(store.triages).toHaveLength(0);
  });

  it("keeps triages within 30 days on read", async () => {
    const recentMs = Date.now() - 29 * 24 * 60 * 60 * 1000; // 29 days ago
    const data: TriageStoreFile = {
      version: 1,
      triages: [makeTriage("recent-msg", recentMs)],
    };
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(data));
    const store = await readTriageStore(storePath);
    expect(store.triages).toHaveLength(1);
    expect(store.triages[0].messageId).toBe("recent-msg");
  });
});

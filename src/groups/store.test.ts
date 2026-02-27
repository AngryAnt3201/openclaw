import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GroupStoreFile, GroupTranscript } from "./types.js";
import {
  resolveGroupStorePath,
  emptyGroupStore,
  emptyTranscript,
  readGroupStore,
  writeGroupStore,
  readTranscript,
  writeTranscript,
} from "./store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "group-store-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveGroupStorePath", () => {
  it("returns custom path when provided", () => {
    const p = resolveGroupStorePath("/custom/path");
    expect(p).toBe("/custom/path");
  });

  it("returns default path under HOME", () => {
    vi.stubEnv("HOME", "/mock-home");
    const p = resolveGroupStorePath();
    expect(p).toBe("/mock-home/.openclaw/groups");
  });
});

describe("emptyGroupStore", () => {
  it("returns fresh object each call", () => {
    const a = emptyGroupStore();
    const b = emptyGroupStore();
    expect(a).toEqual({ version: 1, groups: [] });
    expect(a).not.toBe(b);
  });
});

describe("emptyTranscript", () => {
  it("returns fresh transcript", () => {
    const t = emptyTranscript("g1");
    expect(t).toEqual({ groupId: "g1", messages: [], lastSeq: 0 });
  });
});

describe("readGroupStore", () => {
  it("returns empty store when file missing", async () => {
    const storePath = path.join(tmpDir, "store.json");
    const result = await readGroupStore(storePath);
    expect(result).toEqual({ version: 1, groups: [] });
  });

  it("reads valid store", async () => {
    const storePath = path.join(tmpDir, "store.json");
    const store: GroupStoreFile = {
      version: 1,
      groups: [
        {
          id: "g1",
          label: "Test",
          agents: ["a"],
          activation: "always",
          historyLimit: 50,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    await fs.writeFile(storePath, JSON.stringify(store), "utf-8");
    const result = await readGroupStore(storePath);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.id).toBe("g1");
  });

  it("returns empty on malformed JSON", async () => {
    const storePath = path.join(tmpDir, "store.json");
    await fs.writeFile(storePath, "not json", "utf-8");
    const result = await readGroupStore(storePath);
    expect(result).toEqual({ version: 1, groups: [] });
  });
});

describe("writeGroupStore + readGroupStore roundtrip", () => {
  it("persists and reads back", async () => {
    const storePath = path.join(tmpDir, "store.json");
    const store: GroupStoreFile = {
      version: 1,
      groups: [
        {
          id: "g1",
          label: "X",
          agents: ["a", "b"],
          activation: "mention",
          historyLimit: 30,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };
    await writeGroupStore(storePath, store);
    const result = await readGroupStore(storePath);
    expect(result).toEqual(store);
  });
});

describe("readTranscript", () => {
  it("returns empty when file missing", async () => {
    const tPath = path.join(tmpDir, "g1", "transcript.json");
    const result = await readTranscript(tPath, "g1");
    expect(result).toEqual({ groupId: "g1", messages: [], lastSeq: 0 });
  });
});

describe("writeTranscript + readTranscript roundtrip", () => {
  it("persists and reads back", async () => {
    const dir = path.join(tmpDir, "g1");
    await fs.mkdir(dir, { recursive: true });
    const tPath = path.join(dir, "transcript.json");
    const transcript: GroupTranscript = {
      groupId: "g1",
      messages: [
        {
          id: "msg-1",
          seq: 1,
          role: "user",
          content: "hi",
          timestamp: 1,
          state: "final",
        },
      ],
      lastSeq: 1,
    };
    await writeTranscript(tPath, transcript);
    const result = await readTranscript(tPath, "g1");
    expect(result).toEqual(transcript);
  });
});

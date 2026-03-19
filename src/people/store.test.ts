import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PeopleStoreFile } from "./types.js";
import { emptyStore, readPeopleStore, writePeopleStore, resolvePeopleStorePath } from "./store.js";

let tmpDir: string;
let storePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "people-store-"));
  storePath = path.join(tmpDir, "store.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("emptyStore", () => {
  it("returns fresh store with no shared references", () => {
    const a = emptyStore();
    const b = emptyStore();
    a.persons.push({ id: "x" } as any);
    expect(b.persons).toHaveLength(0);
  });
});

describe("readPeopleStore", () => {
  it("returns empty store when file does not exist", async () => {
    const store = await readPeopleStore(storePath);
    expect(store.version).toBe(1);
    expect(store.persons).toHaveLength(0);
    expect(store.organizations).toHaveLength(0);
    expect(store.groups).toHaveLength(0);
    expect(store.suggestions).toHaveLength(0);
  });

  it("reads existing store from disk", async () => {
    const data: PeopleStoreFile = {
      version: 1,
      persons: [
        {
          id: "p1",
          displayName: "Alice",
          accounts: [],
          groupIds: [],
          tags: [],
          aiTopics: [],
          notes: "",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
      organizations: [],
      groups: [],
      suggestions: [],
    };
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify(data));
    const store = await readPeopleStore(storePath);
    expect(store.persons).toHaveLength(1);
    expect(store.persons[0].displayName).toBe("Alice");
  });
});

describe("writePeopleStore", () => {
  it("writes store atomically and can be read back", async () => {
    const store = emptyStore();
    store.persons.push({
      id: "p1",
      displayName: "Bob",
      accounts: [],
      groupIds: [],
      tags: [],
      aiTopics: [],
      notes: "",
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    await writePeopleStore(storePath, store);
    const read = await readPeopleStore(storePath);
    expect(read.persons).toHaveLength(1);
    expect(read.persons[0].displayName).toBe("Bob");
  });

  it("creates parent directories if missing", async () => {
    const deepPath = path.join(tmpDir, "a", "b", "store.json");
    await writePeopleStore(deepPath, emptyStore());
    const read = await readPeopleStore(deepPath);
    expect(read.version).toBe(1);
  });
});

describe("resolvePeopleStorePath", () => {
  it("returns default path under home directory", () => {
    const p = resolvePeopleStorePath();
    expect(p).toContain("people");
    expect(p).toContain("store.json");
  });
});

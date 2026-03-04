import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { WorkspaceStoreFile } from "./types.js";
import {
  resolveWorkspaceStorePath,
  emptyStore,
  readWorkspaceStore,
  writeWorkspaceStore,
} from "./store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-store-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolveWorkspaceStorePath", () => {
  it("returns custom path when provided", () => {
    const result = resolveWorkspaceStorePath("/custom/workspaces/store.json");
    expect(result).toBe(path.resolve("/custom/workspaces/store.json"));
  });

  it("returns default path under HOME/.openclaw/workspaces when no custom path given", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolveWorkspaceStorePath();
    expect(result).toBe(path.join("/home/testuser", ".openclaw", "workspaces", "store.json"));
  });
});

// ---------------------------------------------------------------------------
// emptyStore factory
// ---------------------------------------------------------------------------

describe("emptyStore", () => {
  it("returns a fresh object each call (no shared references)", () => {
    const a = emptyStore();
    const b = emptyStore();
    expect(a).not.toBe(b);
    expect(a.workspaces).not.toBe(b.workspaces);
    a.workspaces.push({ id: "x" } as any);
    expect(b.workspaces).toHaveLength(0);
  });

  it("returns version 1 with empty workspaces", () => {
    const store = emptyStore();
    expect(store.version).toBe(1);
    expect(store.workspaces).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

describe("readWorkspaceStore", () => {
  it("returns empty store when file does not exist", async () => {
    const filePath = path.join(tmpDir, "nonexistent.json");
    const store = await readWorkspaceStore(filePath);
    expect(store.version).toBe(1);
    expect(store.workspaces).toEqual([]);
  });

  it("returns empty store when file contains invalid JSON", async () => {
    const filePath = path.join(tmpDir, "bad.json");
    await fs.writeFile(filePath, "not json", "utf-8");
    const store = await readWorkspaceStore(filePath);
    expect(store.workspaces).toEqual([]);
  });

  it("returns empty store when workspaces is not an array", async () => {
    const filePath = path.join(tmpDir, "invalid.json");
    await fs.writeFile(filePath, JSON.stringify({ version: 1, workspaces: "oops" }), "utf-8");
    const store = await readWorkspaceStore(filePath);
    expect(store.workspaces).toEqual([]);
  });

  it("reads a valid store file", async () => {
    const filePath = path.join(tmpDir, "store.json");
    const data: WorkspaceStoreFile = {
      version: 1,
      workspaces: [
        {
          id: "ws-1",
          name: "Test",
          description: "",
          directories: [],
          bindings: [],
          tags: [],
          createdAtMs: 1000,
          updatedAtMs: 1000,
        },
      ],
    };
    await fs.writeFile(filePath, JSON.stringify(data), "utf-8");
    const store = await readWorkspaceStore(filePath);
    expect(store.workspaces).toHaveLength(1);
    expect(store.workspaces[0]!.id).toBe("ws-1");
  });
});

describe("writeWorkspaceStore", () => {
  it("creates directories and writes atomically", async () => {
    const filePath = path.join(tmpDir, "nested", "dir", "store.json");
    const data: WorkspaceStoreFile = {
      version: 1,
      workspaces: [
        {
          id: "ws-2",
          name: "Written",
          description: "",
          directories: [],
          bindings: [],
          tags: [],
          createdAtMs: 2000,
          updatedAtMs: 2000,
        },
      ],
    };
    await writeWorkspaceStore(filePath, data);

    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.workspaces).toHaveLength(1);
    expect(parsed.workspaces[0].name).toBe("Written");
  });

  it("overwrites existing file", async () => {
    const filePath = path.join(tmpDir, "overwrite.json");
    await writeWorkspaceStore(filePath, emptyStore());
    const first = await readWorkspaceStore(filePath);
    expect(first.workspaces).toHaveLength(0);

    const data: WorkspaceStoreFile = {
      version: 1,
      workspaces: [
        {
          id: "ws-3",
          name: "Updated",
          description: "",
          directories: [],
          bindings: [],
          tags: [],
          createdAtMs: 3000,
          updatedAtMs: 3000,
        },
      ],
    };
    await writeWorkspaceStore(filePath, data);
    const second = await readWorkspaceStore(filePath);
    expect(second.workspaces).toHaveLength(1);
  });
});

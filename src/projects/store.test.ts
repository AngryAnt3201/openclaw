// ---------------------------------------------------------------------------
// Project Store – Tests
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ProjectStoreFile, Project } from "./types.js";
import {
  resolveProjectStorePath,
  emptyStore,
  readProjectStore,
  writeProjectStore,
} from "./store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-store-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolveProjectStorePath", () => {
  it("returns custom path when provided", () => {
    const result = resolveProjectStorePath("/custom/projects/store.json");
    expect(result).toBe(path.resolve("/custom/projects/store.json"));
  });

  it("returns default path under HOME/.openclaw/projects/store.json when no custom path given", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolveProjectStorePath();
    expect(result).toBe(
      path.join("/home/testuser", ".openclaw", "projects", "store.json"),
    );
  });

  it("resolves a relative path when HOME is empty string", () => {
    vi.stubEnv("HOME", "");
    const result = resolveProjectStorePath();
    // Empty string is not nullish, so ?? does not fall through;
    // path.join("", ...) yields a relative path.
    expect(result).toBe(
      path.join("", ".openclaw", "projects", "store.json"),
    );
  });
});

// ---------------------------------------------------------------------------
// Empty factory function
// ---------------------------------------------------------------------------

describe("emptyStore", () => {
  it("returns a fresh object with version 1 and empty projects array", () => {
    const store = emptyStore();
    expect(store).toEqual({ version: 1, projects: [] });
  });

  it("returns a new object each call (not same reference)", () => {
    const a = emptyStore();
    const b = emptyStore();
    expect(a).not.toBe(b);
    // Mutating one does not affect the other
    a.projects.push({} as Project);
    expect(b.projects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Read / Write round-trip
// ---------------------------------------------------------------------------

describe("readProjectStore / writeProjectStore", () => {
  it("round-trips store data", async () => {
    const filePath = path.join(tmpDir, "store.json");
    const project: Project = {
      id: "proj-1",
      name: "Test Project",
      description: "A test project",
      color: "#4F8CFF",
      icon: "\uD83D\uDCC1",
      status: "active",
      createdAtMs: 1000,
      updatedAtMs: 1000,
    };
    const data: ProjectStoreFile = { version: 1, projects: [project] };

    await writeProjectStore(filePath, data);
    const result = await readProjectStore(filePath);

    expect(result.version).toBe(1);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]!.id).toBe("proj-1");
    expect(result.projects[0]!.name).toBe("Test Project");
    expect(result.projects[0]!.description).toBe("A test project");
    expect(result.projects[0]!.color).toBe("#4F8CFF");
    expect(result.projects[0]!.status).toBe("active");
  });

  it("returns empty store when file does not exist", async () => {
    const filePath = path.join(tmpDir, "nonexistent.json");
    const result = await readProjectStore(filePath);
    expect(result).toEqual({ version: 1, projects: [] });
  });

  it("returns empty store when file contains invalid JSON", async () => {
    const filePath = path.join(tmpDir, "store.json");
    await fs.writeFile(filePath, "{ broken json", "utf-8");
    const result = await readProjectStore(filePath);
    expect(result).toEqual({ version: 1, projects: [] });
  });

  it("returns empty store when projects field is not an array", async () => {
    const filePath = path.join(tmpDir, "store.json");
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 1, projects: "bad" }),
      "utf-8",
    );
    const result = await readProjectStore(filePath);
    expect(result).toEqual({ version: 1, projects: [] });
  });
});

// ---------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------

describe("Atomic writes", () => {
  it("leaves no .tmp file behind after write", async () => {
    const filePath = path.join(tmpDir, "store.json");
    await writeProjectStore(filePath, { version: 1, projects: [] });
    const files = await fs.readdir(tmpDir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("creates parent directories if they do not exist", async () => {
    const deepPath = path.join(tmpDir, "a", "b", "c", "store.json");
    await writeProjectStore(deepPath, { version: 1, projects: [] });
    const raw = await fs.readFile(deepPath, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, projects: [] });
  });
});

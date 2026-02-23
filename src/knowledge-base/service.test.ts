import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KBConfig } from "./types.js";
import { KBService, type KBServiceDeps } from "./service.js";
import { writeNote } from "./store.js";

// ---------------------------------------------------------------------------
// Temp KB setup / teardown
// ---------------------------------------------------------------------------

let vaultPath: string;

beforeEach(async () => {
  vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), "kb-svc-test-"));
});

afterEach(async () => {
  await fs.rm(vaultPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<KBConfig>): KBConfig {
  return {
    enabled: true,
    provider: "obsidian",
    vaultPath,
    vaultName: "TestVault",
    syncFolder: "_miranda",
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<KBServiceDeps>): KBServiceDeps {
  return {
    config: makeConfig(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcast: vi.fn(),
    ...overrides,
  };
}

function kbPath(deps: KBServiceDeps): string {
  const syncFolder = deps.config.syncFolder || "_miranda";
  return `${deps.config.vaultPath}/${syncFolder}`;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

describe("KBService.init", () => {
  it("creates KB directory structure", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    // ensureKBStructure creates _miranda subdirectories under vaultPath
    expect(existsSync(path.join(vaultPath, "_miranda", "tasks"))).toBe(true);
    expect(existsSync(path.join(vaultPath, "_miranda", "daily"))).toBe(true);
    expect(existsSync(path.join(vaultPath, "_miranda", "clips"))).toBe(true);
    expect(existsSync(path.join(vaultPath, "_miranda", "transcripts"))).toBe(true);
    expect(existsSync(path.join(vaultPath, "_miranda", "calendar"))).toBe(true);
    expect(existsSync(path.join(vaultPath, "_miranda", "code"))).toBe(true);
  });

  it("logs initialization message", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    expect(deps.log.info).toHaveBeenCalledWith(expect.stringContaining("kb initialized"));
  });

  it("rebuilds the search index from existing notes", async () => {
    const deps = makeDeps();
    const syncPath = kbPath(deps);

    // Pre-populate notes in the sync folder
    await fs.mkdir(syncPath, { recursive: true });
    await writeNote(syncPath, "note-a.md", "# Alpha\n\nSome alpha content about testing.");

    const svc = new KBService(deps);
    await svc.init();

    // Search should find the pre-existing note
    const results = svc.search("alpha");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("note-a.md");
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("KBService.list", () => {
  it("returns all notes when no filter is given", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "one.md", content: "# One" });
    await svc.create({ path: "two.md", content: "# Two" });

    const notes = await svc.list();
    const paths = notes.map((n) => n.path).toSorted();
    expect(paths).toEqual(["one.md", "two.md"]);
  });

  it("filters by folder", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "root.md", content: "# Root" });
    await svc.create({ path: "projects/alpha.md", content: "# Alpha" });
    await svc.create({ path: "projects/beta.md", content: "# Beta" });

    const notes = await svc.list({ folder: "projects" });
    const paths = notes.map((n) => n.path).toSorted();
    expect(paths).toEqual(["projects/alpha.md", "projects/beta.md"]);
  });

  it("filters by tags", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "tagged.md", content: "# Tagged\n\nHello #important" });
    await svc.create({ path: "untagged.md", content: "# Untagged\n\nNothing here" });

    const notes = await svc.list({ tags: ["important"] });
    expect(notes.length).toBe(1);
    expect(notes[0]!.path).toBe("tagged.md");
  });

  it("filters by query (full-text search)", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "about-cats.md", content: "# Cats\n\nCats are wonderful pets." });
    await svc.create({ path: "about-dogs.md", content: "# Dogs\n\nDogs are loyal companions." });

    const notes = await svc.list({ query: "cats" });
    expect(notes.length).toBe(1);
    expect(notes[0]!.path).toBe("about-cats.md");
  });

  it("respects limit", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "a.md", content: "# A" });
    await svc.create({ path: "b.md", content: "# B" });
    await svc.create({ path: "c.md", content: "# C" });

    const notes = await svc.list({ limit: 2 });
    expect(notes.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("KBService.get", () => {
  it("returns a full note when it exists", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "hello.md", content: "# Hello\n\nWorld" });

    const note = await svc.get("hello.md");
    expect(note).not.toBeNull();
    expect(note!.path).toBe("hello.md");
    expect(note!.title).toBe("Hello");
    expect(note!.content).toBe("# Hello\n\nWorld");
  });

  it("returns null for non-existent note", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const note = await svc.get("ghost.md");
    expect(note).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("KBService.create", () => {
  it("creates a note on disk and returns it", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const note = await svc.create({ path: "new-note.md", content: "# New Note\n\nBody text." });
    expect(note.path).toBe("new-note.md");
    expect(note.title).toBe("New Note");
    expect(note.content).toBe("# New Note\n\nBody text.");
    expect(note.sizeBytes).toBeGreaterThan(0);

    // Verify on disk
    const filePath = path.join(kbPath(deps), "new-note.md");
    expect(existsSync(filePath)).toBe(true);
  });

  it("broadcasts kb.note.created event", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "event-test.md", content: "# Event" });

    expect(deps.broadcast).toHaveBeenCalledWith("kb.note.created", {
      path: "event-test.md",
      title: "Event",
    });
  });

  it("applies frontmatter when provided", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const note = await svc.create({
      path: "with-fm.md",
      content: "# With Frontmatter",
      frontmatter: { tags: ["test"], status: "draft" },
    });

    expect(note.content).toContain("---");
    expect(note.content).toContain("status: draft");
    expect(note.content).toContain("# With Frontmatter");
  });

  it("creates notes with empty content when none provided", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const note = await svc.create({ path: "empty.md" });
    expect(note.content).toBe("");
  });

  it("updates the search index after creation", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({
      path: "searchable.md",
      content: "# Searchable\n\nUnique quantum content here.",
    });

    const results = svc.search("quantum");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("searchable.md");
  });

  it("creates nested directory structure for deep paths", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const note = await svc.create({
      path: "deep/nested/note.md",
      content: "# Deep Note",
    });
    expect(note.path).toBe("deep/nested/note.md");

    const filePath = path.join(kbPath(deps), "deep", "nested", "note.md");
    expect(existsSync(filePath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("KBService.search", () => {
  it("returns matching results", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "apple.md", content: "# Apple\n\nApple is a fruit." });
    await svc.create({ path: "banana.md", content: "# Banana\n\nBanana is yellow." });

    const results = svc.search("apple");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.path).toBe("apple.md");
    expect(results[0]!.title).toBe("Apple");
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("returns empty array for no matches", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "note.md", content: "# Note\n\nSome content." });

    const results = svc.search("xyznonexistent");
    expect(results.length).toBe(0);
  });

  it("returns empty array for empty query", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const results = svc.search("");
    expect(results.length).toBe(0);
  });

  it("respects limit option", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "a.md", content: "# Alpha\n\nAlpha content information." });
    await svc.create({ path: "b.md", content: "# Beta\n\nAlpha content also here." });
    await svc.create({ path: "c.md", content: "# Gamma\n\nAlpha again repeated." });

    const results = svc.search("alpha", { limit: 1 });
    expect(results.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getTags
// ---------------------------------------------------------------------------

describe("KBService.getTags", () => {
  it("returns all unique tags sorted", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "a.md", content: "# A\n\n#alpha #beta" });
    await svc.create({ path: "b.md", content: "# B\n\n#beta #gamma" });

    const tags = svc.getTags();
    expect(tags).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns empty array when no notes have tags", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "plain.md", content: "# Plain\n\nNo tags here." });

    const tags = svc.getTags();
    expect(tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

describe("KBService.status", () => {
  it("returns correct status when configured", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await svc.create({ path: "note.md", content: "# Note" });

    const st = svc.status();
    expect(st.configured).toBe(true);
    expect(st.provider).toBe("obsidian");
    expect(st.vaultPath).toBe(vaultPath);
    expect(st.noteCount).toBe(1);
  });

  it("returns configured=false when disabled", async () => {
    const deps = makeDeps({ config: makeConfig({ enabled: false }) });
    const svc = new KBService(deps);
    await svc.init();

    const st = svc.status();
    expect(st.configured).toBe(false);
  });

  it("returns noteCount=0 when no notes exist", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const st = svc.status();
    expect(st.noteCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// URI helpers
// ---------------------------------------------------------------------------

describe("KBService URI helpers", () => {
  it("openURI() returns provider open vault URI", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const uri = svc.openURI();
    expect(uri).toBe("obsidian://open?vault=TestVault");
  });

  it("openNoteURI() returns provider note URI", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const uri = svc.openNoteURI("projects/design.md");
    expect(uri).toBe("obsidian://open?vault=TestVault&file=projects%2Fdesign.md");
  });

  it("searchURI() returns provider search URI", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    const uri = svc.searchURI("my query");
    expect(uri).toBe("obsidian://search?vault=TestVault&query=my%20query");
  });

  it("uses logseq provider when configured", async () => {
    const deps = makeDeps({ config: makeConfig({ provider: "logseq", vaultName: "MyGraph" }) });
    const svc = new KBService(deps);
    await svc.init();

    const uri = svc.openURI();
    expect(uri).toBe("logseq://graph/MyGraph");
  });
});

// ---------------------------------------------------------------------------
// getVaultPath / getConfig
// ---------------------------------------------------------------------------

describe("KBService.getVaultPath", () => {
  it("returns the resolved sync path", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    expect(svc.getVaultPath()).toBe(`${vaultPath}/_miranda`);
  });
});

describe("KBService.getConfig", () => {
  it("returns a copy of the config", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);

    const config = svc.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.provider).toBe("obsidian");
    expect(config.vaultPath).toBe(vaultPath);

    // Verify it's a copy (not the same object)
    config.enabled = false;
    expect(svc.getConfig().enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

describe("KBService.close", () => {
  it("is a no-op and does not throw", async () => {
    const deps = makeDeps();
    const svc = new KBService(deps);
    await svc.init();

    await expect(svc.close()).resolves.toBeUndefined();
  });
});

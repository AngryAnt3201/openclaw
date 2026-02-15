import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VaultService } from "./service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let vaultPath: string;
let service: VaultService;
let broadcasts: Array<{ event: string; payload: unknown }>;
const log = { info: () => {}, warn: () => {}, error: () => {} };

beforeEach(async () => {
  vaultPath = await mkdtemp(path.join(tmpdir(), "vault-svc-"));
  broadcasts = [];
  service = new VaultService({
    vaultPath,
    config: {},
    log,
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    nowMs: () => 1_000_000,
  });
  await service.init();
});

afterEach(async () => {
  await service.close();
  await rm(vaultPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

describe("VaultService.init", () => {
  it("creates vault directory structure on init", async () => {
    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(vaultPath, "_system/tasks"))).toBe(true);
    expect(existsSync(path.join(vaultPath, "_system/daily"))).toBe(true);
    expect(existsSync(path.join(vaultPath, "_system/templates"))).toBe(true);
  });

  it("initializes without error on empty vault", async () => {
    // The beforeEach already initializes; verify the service is usable
    const notes = await service.list();
    expect(Array.isArray(notes)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("VaultService.create", () => {
  it("creates a note and returns VaultNote", async () => {
    const note = await service.create({ path: "hello.md", content: "# Hello\n\nWorld" });

    expect(note.path).toBe("hello.md");
    expect(note.title).toBe("Hello");
    expect(note.content).toBe("# Hello\n\nWorld");
    expect(note.sizeBytes).toBeGreaterThan(0);
  });

  it("writes the file to disk", async () => {
    await service.create({ path: "disk-check.md", content: "on disk" });
    const raw = await readFile(path.join(vaultPath, "disk-check.md"), "utf-8");
    expect(raw).toBe("on disk");
  });

  it("broadcasts vault.note.created event", async () => {
    await service.create({ path: "events.md", content: "# Events" });
    const created = broadcasts.find((b) => b.event === "vault.note.created");
    expect(created).toBeDefined();
    expect((created!.payload as { path: string }).path).toBe("events.md");
  });

  it("creates note with frontmatter", async () => {
    const note = await service.create({
      path: "with-fm.md",
      content: "body text",
      frontmatter: { title: "My Note", tags: ["test"] },
    });

    expect(note.content).toContain("---");
    expect(note.content).toContain("title: My Note");
    expect(note.content).toContain("body text");
  });

  it("creates note using template", async () => {
    // Create a template first
    await service.create({
      path: "_system/templates/meeting.md",
      content: "# Meeting Notes\n\n## Attendees\n\n## Agenda\n",
    });

    const note = await service.create({
      path: "meetings/standup.md",
      templatePath: "_system/templates/meeting.md",
    });

    expect(note.content).toContain("# Meeting Notes");
    expect(note.content).toContain("## Attendees");
  });

  it("creates notes in nested folders", async () => {
    const note = await service.create({ path: "projects/alpha/readme.md", content: "# Alpha" });
    expect(note.path).toBe("projects/alpha/readme.md");
    expect(note.title).toBe("Alpha");
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("VaultService.get", () => {
  it("returns an existing note", async () => {
    await service.create({ path: "get-test.md", content: "# Get Test\n\nSome content" });
    const note = await service.get("get-test.md");

    expect(note).not.toBeNull();
    expect(note!.path).toBe("get-test.md");
    expect(note!.title).toBe("Get Test");
    expect(note!.content).toContain("Some content");
  });

  it("returns null for a missing note", async () => {
    const note = await service.get("does-not-exist.md");
    expect(note).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("VaultService.update", () => {
  it("updates note content", async () => {
    await service.create({ path: "upd.md", content: "# Original" });
    const updated = await service.update("upd.md", { content: "# Updated\n\nNew body" });

    expect(updated).not.toBeNull();
    expect(updated!.content).toBe("# Updated\n\nNew body");
    expect(updated!.title).toBe("Updated");
  });

  it("updates note frontmatter", async () => {
    await service.create({ path: "fm-upd.md", content: "body here" });
    const updated = await service.update("fm-upd.md", {
      frontmatter: { status: "done", priority: "high" },
    });

    expect(updated).not.toBeNull();
    expect(updated!.content).toContain("status: done");
    expect(updated!.content).toContain("priority: high");
    expect(updated!.content).toContain("body here");
  });

  it("returns null when updating a missing note", async () => {
    const result = await service.update("ghost.md", { content: "nope" });
    expect(result).toBeNull();
  });

  it("broadcasts vault.note.updated event", async () => {
    await service.create({ path: "upd-evt.md", content: "before" });
    broadcasts = [];
    await service.update("upd-evt.md", { content: "after" });

    const updated = broadcasts.find((b) => b.event === "vault.note.updated");
    expect(updated).toBeDefined();
    expect((updated!.payload as { path: string }).path).toBe("upd-evt.md");
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("VaultService.delete", () => {
  it("deletes an existing note", async () => {
    await service.create({ path: "del.md", content: "bye" });
    const ok = await service.delete("del.md");
    expect(ok).toBe(true);

    const after = await service.get("del.md");
    expect(after).toBeNull();
  });

  it("returns false when deleting a missing note", async () => {
    const ok = await service.delete("no-such-file.md");
    expect(ok).toBe(false);
  });

  it("broadcasts vault.note.deleted event", async () => {
    await service.create({ path: "del-evt.md", content: "bye" });
    broadcasts = [];
    await service.delete("del-evt.md");

    const deleted = broadcasts.find((b) => b.event === "vault.note.deleted");
    expect(deleted).toBeDefined();
    expect((deleted!.payload as { path: string }).path).toBe("del-evt.md");
  });
});

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

describe("VaultService.move", () => {
  it("moves a note to a new path", async () => {
    await service.create({ path: "src.md", content: "# Movable" });
    const ok = await service.move("src.md", "dest/moved.md");
    expect(ok).toBe(true);

    const old = await service.get("src.md");
    expect(old).toBeNull();

    const moved = await service.get("dest/moved.md");
    expect(moved).not.toBeNull();
    expect(moved!.content).toBe("# Movable");
  });

  it("returns false when source does not exist", async () => {
    const ok = await service.move("phantom.md", "target.md");
    expect(ok).toBe(false);
  });

  it("broadcasts vault.note.moved event", async () => {
    await service.create({ path: "mv-evt.md", content: "moving" });
    broadcasts = [];
    await service.move("mv-evt.md", "archive/mv-evt.md");

    const moved = broadcasts.find((b) => b.event === "vault.note.moved");
    expect(moved).toBeDefined();
    const payload = moved!.payload as { from: string; to: string };
    expect(payload.from).toBe("mv-evt.md");
    expect(payload.to).toBe("archive/mv-evt.md");
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("VaultService.list", () => {
  it("lists all notes in the vault", async () => {
    await service.create({ path: "a.md", content: "# A" });
    await service.create({ path: "b.md", content: "# B" });
    const notes = await service.list();

    const paths = notes.map((n) => n.path);
    expect(paths).toContain("a.md");
    expect(paths).toContain("b.md");
  });

  it("filters notes by folder", async () => {
    await service.create({ path: "docs/one.md", content: "# One" });
    await service.create({ path: "notes/two.md", content: "# Two" });
    const filtered = await service.list({ folder: "docs" });

    expect(filtered.length).toBe(1);
    expect(filtered[0]!.path).toBe("docs/one.md");
  });

  it("filters notes by tags", async () => {
    await service.create({ path: "tagged.md", content: "# Tagged\n\n#project" });
    await service.create({ path: "untagged.md", content: "# Untagged" });
    const filtered = await service.list({ tags: ["project"] });

    expect(filtered.length).toBe(1);
    expect(filtered[0]!.path).toBe("tagged.md");
  });

  it("limits the number of results", async () => {
    await service.create({ path: "l1.md", content: "# L1" });
    await service.create({ path: "l2.md", content: "# L2" });
    await service.create({ path: "l3.md", content: "# L3" });
    const limited = await service.list({ limit: 2 });

    expect(limited.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("VaultService.search", () => {
  it("finds notes by title", async () => {
    await service.create({ path: "quantum.md", content: "# Quantum Computing" });
    await service.create({ path: "cooking.md", content: "# Cooking Recipes" });
    const results = service.search("quantum");

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.path).toBe("quantum.md");
  });

  it("finds notes by content", async () => {
    await service.create({
      path: "article.md",
      content: "# General\n\nThe mitochondria is the powerhouse of the cell.",
    });
    const results = service.search("mitochondria");

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.path).toBe("article.md");
  });

  it("returns empty array when nothing matches", async () => {
    await service.create({ path: "irrelevant.md", content: "# Hello" });
    const results = service.search("xyzzyplugh");
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getBacklinks
// ---------------------------------------------------------------------------

describe("VaultService.getBacklinks", () => {
  it("finds notes that link to the target note", async () => {
    await service.create({ path: "target.md", content: "# Target Note" });
    await service.create({
      path: "source.md",
      content: "# Source\n\nSee [[target]] for more info.",
    });

    const backlinks = service.getBacklinks("target.md");
    expect(backlinks.length).toBe(1);
    expect(backlinks[0]!.sourcePath).toBe("source.md");
    expect(backlinks[0]!.sourceTitle).toBe("Source");
    expect(backlinks[0]!.context).toContain("[[target]]");
  });
});

// ---------------------------------------------------------------------------
// getGraph
// ---------------------------------------------------------------------------

describe("VaultService.getGraph", () => {
  it("returns nodes and edges for linked notes", async () => {
    await service.create({ path: "nodeA.md", content: "# Node A\n\n[[nodeB]]" });
    await service.create({ path: "nodeB.md", content: "# Node B\n\n[[nodeA]]" });

    const graph = await service.getGraph();

    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(graph.edges.length).toBeGreaterThanOrEqual(1);

    const nodePaths = graph.nodes.map((n) => n.path);
    expect(nodePaths).toContain("nodeA.md");
    expect(nodePaths).toContain("nodeB.md");
  });
});

// ---------------------------------------------------------------------------
// getTags
// ---------------------------------------------------------------------------

describe("VaultService.getTags", () => {
  it("returns unique sorted tags across all notes", async () => {
    await service.create({ path: "t1.md", content: "# T1\n\n#alpha #beta" });
    await service.create({ path: "t2.md", content: "# T2\n\n#beta #gamma" });

    const tags = service.getTags();
    expect(tags).toEqual(["alpha", "beta", "gamma"]);
  });
});

// ---------------------------------------------------------------------------
// getTree
// ---------------------------------------------------------------------------

describe("VaultService.getTree", () => {
  it("returns a tree structure representing the vault", async () => {
    await service.create({ path: "root.md", content: "# Root" });
    await service.create({ path: "sub/child.md", content: "# Child" });

    const tree = await service.getTree();
    expect(tree.type).toBe("folder");
    expect(tree.children).toBeDefined();
    expect(Array.isArray(tree.children)).toBe(true);

    // Should contain the sub folder and root.md at some level
    const names = tree.children!.map((c) => c.name);
    expect(names).toContain("root.md");
  });
});

// ---------------------------------------------------------------------------
// getDailyNote
// ---------------------------------------------------------------------------

describe("VaultService.getDailyNote", () => {
  it("creates a new daily note when none exists", async () => {
    const note = await service.getDailyNote("2025-03-15");

    expect(note.path).toBe("_system/daily/2025-03-15.md");
    expect(note.content).toContain("date: 2025-03-15");
    expect(note.content).toContain("# 2025-03-15");
  });

  it("returns an existing daily note without recreating it", async () => {
    const first = await service.getDailyNote("2025-06-01");
    const second = await service.getDailyNote("2025-06-01");

    expect(first.path).toBe(second.path);
    expect(first.content).toBe(second.content);
  });
});

// ---------------------------------------------------------------------------
// getCanvas + updateCanvas
// ---------------------------------------------------------------------------

describe("VaultService canvas operations", () => {
  it("returns null for a missing canvas", async () => {
    const result = await service.getCanvas("nonexistent.canvas");
    expect(result).toBeNull();
  });

  it("writes and reads canvas data", async () => {
    const canvasData = {
      nodes: [
        {
          id: "n1",
          type: "text" as const,
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          text: "Hello Canvas",
        },
      ],
      edges: [],
    };

    await service.updateCanvas("test.canvas", canvasData);
    const result = await service.getCanvas("test.canvas");

    expect(result).not.toBeNull();
    expect(result!.nodes.length).toBe(1);
    expect(result!.nodes[0]!.text).toBe("Hello Canvas");
    expect(result!.edges).toEqual([]);
  });

  it("broadcasts vault.canvas.updated event", async () => {
    broadcasts = [];
    await service.updateCanvas("evt.canvas", { nodes: [], edges: [] });

    const updated = broadcasts.find((b) => b.event === "vault.canvas.updated");
    expect(updated).toBeDefined();
    expect((updated!.payload as { path: string }).path).toBe("evt.canvas");
  });
});

// ---------------------------------------------------------------------------
// getMetadata
// ---------------------------------------------------------------------------

describe("VaultService.getMetadata", () => {
  it("returns metadata for an existing note", async () => {
    await service.create({
      path: "meta.md",
      content:
        "---\nstatus: draft\n---\n# Metadata Test\n\n[[other]] #research\n\nSome words here.",
    });

    const metadata = await service.getMetadata("meta.md");
    expect(metadata).not.toBeNull();
    expect(metadata!.frontmatter).toEqual({ status: "draft" });
    expect(metadata!.headings.length).toBe(1);
    expect(metadata!.headings[0]!.text).toBe("Metadata Test");
    expect(metadata!.links.length).toBe(1);
    expect(metadata!.links[0]!.target).toBe("other");
    expect(metadata!.tags.length).toBe(1);
    expect(metadata!.tags[0]!.name).toBe("research");
    expect(metadata!.wordCount).toBeGreaterThan(0);
  });

  it("returns null for a missing note", async () => {
    const metadata = await service.getMetadata("missing.md");
    expect(metadata).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Concurrent writes (locking)
// ---------------------------------------------------------------------------

describe("VaultService locking", () => {
  it("concurrent creates do not corrupt the vault", async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      service.create({ path: `concurrent-${i}.md`, content: `# Note ${i}` }),
    );
    const results = await Promise.all(promises);

    expect(results.length).toBe(10);
    for (let i = 0; i < 10; i++) {
      const note = await service.get(`concurrent-${i}.md`);
      expect(note).not.toBeNull();
      expect(note!.content).toBe(`# Note ${i}`);
    }
  });

  it("concurrent create and update do not conflict", async () => {
    await service.create({ path: "race.md", content: "# Original" });

    const [, updated] = await Promise.all([
      service.create({ path: "race2.md", content: "# Race 2" }),
      service.update("race.md", { content: "# Updated" }),
    ]);

    expect(updated).not.toBeNull();
    expect(updated!.content).toBe("# Updated");

    const race2 = await service.get("race2.md");
    expect(race2).not.toBeNull();
    expect(race2!.content).toBe("# Race 2");
  });
});

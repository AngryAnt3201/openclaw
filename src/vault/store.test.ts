import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTree,
  deleteNote,
  ensureVaultStructure,
  listNotes,
  moveNote,
  readNote,
  resolveVaultPath,
  writeNote,
} from "./store.js";

// ---------------------------------------------------------------------------
// Temp vault setup / teardown
// ---------------------------------------------------------------------------

let vaultPath: string;

beforeEach(async () => {
  vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), "vault-test-"));
});

afterEach(async () => {
  await fs.rm(vaultPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveVaultPath
// ---------------------------------------------------------------------------

describe("resolveVaultPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default path under ~/.miranda/vault when no custom path given", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolveVaultPath();
    expect(result).toBe(path.join("/home/testuser", ".miranda", "vault"));
  });

  it("resolves custom path when provided", () => {
    const result = resolveVaultPath("/custom/vault");
    expect(result).toBe(path.resolve("/custom/vault"));
  });
});

// ---------------------------------------------------------------------------
// ensureVaultStructure
// ---------------------------------------------------------------------------

describe("ensureVaultStructure", () => {
  it("creates the vault root directory if it does not exist", async () => {
    const nested = path.join(vaultPath, "deep", "nested", "vault");
    await ensureVaultStructure(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("creates _system subdirectories (tasks, daily, templates)", async () => {
    await ensureVaultStructure(vaultPath);
    expect(existsSync(path.join(vaultPath, "_system", "tasks"))).toBe(true);
    expect(existsSync(path.join(vaultPath, "_system", "daily"))).toBe(true);
    expect(existsSync(path.join(vaultPath, "_system", "templates"))).toBe(true);
  });

  it("is idempotent when called twice", async () => {
    await ensureVaultStructure(vaultPath);
    await ensureVaultStructure(vaultPath);
    expect(existsSync(path.join(vaultPath, "_system", "tasks"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// writeNote + readNote
// ---------------------------------------------------------------------------

describe("writeNote + readNote", () => {
  it("round-trips a basic markdown note", async () => {
    const content = "# Hello\n\nSome body text.";
    await writeNote(vaultPath, "hello.md", content);
    const note = await readNote(vaultPath, "hello.md");
    expect(note).not.toBeNull();
    expect(note!.path).toBe("hello.md");
    expect(note!.content).toBe(content);
    expect(note!.title).toBe("Hello");
    expect(note!.sizeBytes).toBeGreaterThan(0);
    expect(note!.createdAtMs).toBeGreaterThan(0);
    expect(note!.updatedAtMs).toBeGreaterThan(0);
  });

  it("creates parent directories that do not exist", async () => {
    const notePath = "projects/alpha/design.md";
    await writeNote(vaultPath, notePath, "# Design Doc\n\nDetails here.");
    const note = await readNote(vaultPath, notePath);
    expect(note).not.toBeNull();
    expect(note!.path).toBe(notePath);
    expect(note!.title).toBe("Design Doc");
  });

  it("performs an atomic write (no .tmp leftover)", async () => {
    await writeNote(vaultPath, "atomic.md", "content");
    const tmpFile = path.join(vaultPath, "atomic.md.tmp");
    expect(existsSync(tmpFile)).toBe(false);
    expect(existsSync(path.join(vaultPath, "atomic.md"))).toBe(true);
  });

  it("overwrites an existing note", async () => {
    await writeNote(vaultPath, "overwrite.md", "# Version 1");
    await writeNote(vaultPath, "overwrite.md", "# Version 2");
    const note = await readNote(vaultPath, "overwrite.md");
    expect(note!.content).toBe("# Version 2");
    expect(note!.title).toBe("Version 2");
  });

  it("extracts metadata (tags, links, word count)", async () => {
    const content = "# My Note\n\nSome text #project\n\nSee [[Other Note]] for details.";
    await writeNote(vaultPath, "meta.md", content);
    const note = await readNote(vaultPath, "meta.md");
    expect(note).not.toBeNull();
    expect(note!.metadata.tags.length).toBe(1);
    expect(note!.metadata.tags[0]!.name).toBe("project");
    expect(note!.metadata.links.length).toBe(1);
    expect(note!.metadata.links[0]!.target).toBe("Other Note");
    expect(note!.metadata.wordCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// readNote (missing)
// ---------------------------------------------------------------------------

describe("readNote", () => {
  it("returns null for a non-existent file", async () => {
    const note = await readNote(vaultPath, "does-not-exist.md");
    expect(note).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------

describe("deleteNote", () => {
  it("deletes an existing note and returns true", async () => {
    await writeNote(vaultPath, "to-delete.md", "bye");
    const result = await deleteNote(vaultPath, "to-delete.md");
    expect(result).toBe(true);
    expect(existsSync(path.join(vaultPath, "to-delete.md"))).toBe(false);
  });

  it("returns false when the file does not exist", async () => {
    const result = await deleteNote(vaultPath, "ghost.md");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// moveNote
// ---------------------------------------------------------------------------

describe("moveNote", () => {
  it("moves a note from one path to another", async () => {
    await writeNote(vaultPath, "old.md", "# Moved");
    const result = await moveNote(vaultPath, "old.md", "new.md");
    expect(result).toBe(true);
    expect(existsSync(path.join(vaultPath, "old.md"))).toBe(false);
    const note = await readNote(vaultPath, "new.md");
    expect(note).not.toBeNull();
    expect(note!.content).toBe("# Moved");
  });

  it("creates the target directory if it does not exist", async () => {
    await writeNote(vaultPath, "src.md", "content");
    const result = await moveNote(vaultPath, "src.md", "archive/2024/src.md");
    expect(result).toBe(true);
    const note = await readNote(vaultPath, "archive/2024/src.md");
    expect(note).not.toBeNull();
    expect(note!.content).toBe("content");
  });

  it("returns false when the source file does not exist", async () => {
    const result = await moveNote(vaultPath, "missing.md", "dest.md");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listNotes
// ---------------------------------------------------------------------------

describe("listNotes", () => {
  it("lists all .md files recursively", async () => {
    await writeNote(vaultPath, "root.md", "# Root");
    await writeNote(vaultPath, "sub/child.md", "# Child");
    await writeNote(vaultPath, "sub/deep/leaf.md", "# Leaf");

    const notes = await listNotes(vaultPath);
    const paths = notes.map((n) => n.path).toSorted();
    expect(paths).toEqual(["root.md", "sub/child.md", "sub/deep/leaf.md"]);
  });

  it("skips hidden files and directories", async () => {
    await writeNote(vaultPath, "visible.md", "# Visible");
    // Create a hidden file manually (writeNote uses the note path directly)
    await fs.mkdir(path.join(vaultPath, ".hidden"), { recursive: true });
    await fs.writeFile(path.join(vaultPath, ".hidden", "secret.md"), "# Secret");
    await fs.writeFile(path.join(vaultPath, ".dotfile.md"), "# Dot");

    const notes = await listNotes(vaultPath);
    const paths = notes.map((n) => n.path);
    expect(paths).toEqual(["visible.md"]);
  });

  it("filters by folder when specified", async () => {
    await writeNote(vaultPath, "root.md", "# Root");
    await writeNote(vaultPath, "projects/a.md", "# A");
    await writeNote(vaultPath, "projects/b.md", "# B");
    await writeNote(vaultPath, "journal/today.md", "# Today");

    const notes = await listNotes(vaultPath, "projects");
    const paths = notes.map((n) => n.path).toSorted();
    expect(paths).toEqual(["projects/a.md", "projects/b.md"]);
  });

  it("returns an empty array for a non-existent folder", async () => {
    const notes = await listNotes(vaultPath, "no-such-folder");
    expect(notes).toEqual([]);
  });

  it("populates summary fields (title, tags, linkCount, wordCount)", async () => {
    await writeNote(
      vaultPath,
      "rich.md",
      "# Rich Note\n\nHello world #status/active\n\n[[Link Target]]",
    );
    const notes = await listNotes(vaultPath);
    expect(notes.length).toBe(1);
    const summary = notes[0]!;
    expect(summary.title).toBe("Rich Note");
    expect(summary.tags).toContain("status/active");
    expect(summary.linkCount).toBe(1);
    expect(summary.wordCount).toBeGreaterThan(0);
    expect(summary.createdAtMs).toBeGreaterThan(0);
    expect(summary.updatedAtMs).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildTree
// ---------------------------------------------------------------------------

describe("buildTree", () => {
  it("returns root as a folder node", async () => {
    const tree = await buildTree(vaultPath);
    expect(tree.type).toBe("folder");
    expect(tree.path).toBe(".");
    expect(tree.children).toBeDefined();
  });

  it("includes files and subfolders in the tree", async () => {
    await writeNote(vaultPath, "readme.md", "# Readme");
    await writeNote(vaultPath, "docs/guide.md", "# Guide");

    const tree = await buildTree(vaultPath);
    const childNames = tree.children!.map((c) => c.name);
    expect(childNames).toContain("docs");
    expect(childNames).toContain("readme.md");
  });

  it("sorts folders before files, alphabetical within each group", async () => {
    await writeNote(vaultPath, "zebra.md", "z");
    await writeNote(vaultPath, "alpha.md", "a");
    await writeNote(vaultPath, "bravo/note.md", "b");
    await writeNote(vaultPath, "archive/old.md", "old");

    const tree = await buildTree(vaultPath);
    const names = tree.children!.map((c) => c.name);
    // Folders first (archive, bravo), then files (alpha.md, zebra.md)
    expect(names).toEqual(["archive", "bravo", "alpha.md", "zebra.md"]);
  });

  it("skips hidden directories and files", async () => {
    await writeNote(vaultPath, "visible.md", "v");
    await fs.mkdir(path.join(vaultPath, ".obsidian"), { recursive: true });
    await fs.writeFile(path.join(vaultPath, ".obsidian", "config.json"), "{}");
    await fs.writeFile(path.join(vaultPath, ".hidden.md"), "hidden");

    const tree = await buildTree(vaultPath);
    const names = tree.children!.map((c) => c.name);
    expect(names).not.toContain(".obsidian");
    expect(names).not.toContain(".hidden.md");
    expect(names).toContain("visible.md");
  });
});

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteNote,
  ensureKBStructure,
  listNotes,
  readNote,
  resolveKBPath,
  writeNote,
} from "./store.js";

// ---------------------------------------------------------------------------
// Temp KB setup / teardown
// ---------------------------------------------------------------------------

let kbPath: string;

beforeEach(async () => {
  kbPath = await fs.mkdtemp(path.join(os.tmpdir(), "kb-test-"));
});

afterEach(async () => {
  await fs.rm(kbPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// resolveKBPath
// ---------------------------------------------------------------------------

describe("resolveKBPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default path under ~/.miranda/vault when no custom path given", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolveKBPath();
    expect(result).toBe(path.join("/home/testuser", ".miranda", "vault"));
  });

  it("resolves custom path when provided", () => {
    const result = resolveKBPath("/custom/vault");
    expect(result).toBe(path.resolve("/custom/vault"));
  });
});

// ---------------------------------------------------------------------------
// ensureKBStructure
// ---------------------------------------------------------------------------

describe("ensureKBStructure", () => {
  it("creates the KB root directory if it does not exist", async () => {
    const nested = path.join(kbPath, "deep", "nested", "vault");
    await ensureKBStructure(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("creates _miranda subdirectories (tasks, daily, clips, transcripts, calendar, code)", async () => {
    await ensureKBStructure(kbPath);
    expect(existsSync(path.join(kbPath, "_miranda", "tasks"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_miranda", "daily"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_miranda", "clips"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_miranda", "transcripts"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_miranda", "calendar"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_miranda", "code"))).toBe(true);
  });

  it("is idempotent when called twice", async () => {
    await ensureKBStructure(kbPath);
    await ensureKBStructure(kbPath);
    expect(existsSync(path.join(kbPath, "_miranda", "tasks"))).toBe(true);
  });

  it("accepts a custom syncFolder parameter", async () => {
    await ensureKBStructure(kbPath, "_custom");
    expect(existsSync(path.join(kbPath, "_custom", "tasks"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_custom", "daily"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_custom", "clips"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_custom", "transcripts"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_custom", "calendar"))).toBe(true);
    expect(existsSync(path.join(kbPath, "_custom", "code"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// writeNote + readNote
// ---------------------------------------------------------------------------

describe("writeNote + readNote", () => {
  it("round-trips a basic markdown note", async () => {
    const content = "# Hello\n\nSome body text.";
    await writeNote(kbPath, "hello.md", content);
    const note = await readNote(kbPath, "hello.md");
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
    await writeNote(kbPath, notePath, "# Design Doc\n\nDetails here.");
    const note = await readNote(kbPath, notePath);
    expect(note).not.toBeNull();
    expect(note!.path).toBe(notePath);
    expect(note!.title).toBe("Design Doc");
  });

  it("performs an atomic write (no .tmp leftover)", async () => {
    await writeNote(kbPath, "atomic.md", "content");
    const tmpFile = path.join(kbPath, "atomic.md.tmp");
    expect(existsSync(tmpFile)).toBe(false);
    expect(existsSync(path.join(kbPath, "atomic.md"))).toBe(true);
  });

  it("overwrites an existing note", async () => {
    await writeNote(kbPath, "overwrite.md", "# Version 1");
    await writeNote(kbPath, "overwrite.md", "# Version 2");
    const note = await readNote(kbPath, "overwrite.md");
    expect(note!.content).toBe("# Version 2");
    expect(note!.title).toBe("Version 2");
  });

  it("extracts metadata (tags, links, word count)", async () => {
    const content = "# My Note\n\nSome text #project\n\nSee [[Other Note]] for details.";
    await writeNote(kbPath, "meta.md", content);
    const note = await readNote(kbPath, "meta.md");
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
    const note = await readNote(kbPath, "does-not-exist.md");
    expect(note).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteNote
// ---------------------------------------------------------------------------

describe("deleteNote", () => {
  it("deletes an existing note and returns true", async () => {
    await writeNote(kbPath, "to-delete.md", "bye");
    const result = await deleteNote(kbPath, "to-delete.md");
    expect(result).toBe(true);
    expect(existsSync(path.join(kbPath, "to-delete.md"))).toBe(false);
  });

  it("returns false when the file does not exist", async () => {
    const result = await deleteNote(kbPath, "ghost.md");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// listNotes
// ---------------------------------------------------------------------------

describe("listNotes", () => {
  it("lists all .md files recursively", async () => {
    await writeNote(kbPath, "root.md", "# Root");
    await writeNote(kbPath, "sub/child.md", "# Child");
    await writeNote(kbPath, "sub/deep/leaf.md", "# Leaf");

    const notes = await listNotes(kbPath);
    const paths = notes.map((n) => n.path).toSorted();
    expect(paths).toEqual(["root.md", "sub/child.md", "sub/deep/leaf.md"]);
  });

  it("skips hidden files and directories", async () => {
    await writeNote(kbPath, "visible.md", "# Visible");
    // Create a hidden file manually (writeNote uses the note path directly)
    await fs.mkdir(path.join(kbPath, ".hidden"), { recursive: true });
    await fs.writeFile(path.join(kbPath, ".hidden", "secret.md"), "# Secret");
    await fs.writeFile(path.join(kbPath, ".dotfile.md"), "# Dot");

    const notes = await listNotes(kbPath);
    const paths = notes.map((n) => n.path);
    expect(paths).toEqual(["visible.md"]);
  });

  it("filters by folder when specified", async () => {
    await writeNote(kbPath, "root.md", "# Root");
    await writeNote(kbPath, "projects/a.md", "# A");
    await writeNote(kbPath, "projects/b.md", "# B");
    await writeNote(kbPath, "journal/today.md", "# Today");

    const notes = await listNotes(kbPath, "projects");
    const paths = notes.map((n) => n.path).toSorted();
    expect(paths).toEqual(["projects/a.md", "projects/b.md"]);
  });

  it("returns an empty array for a non-existent folder", async () => {
    const notes = await listNotes(kbPath, "no-such-folder");
    expect(notes).toEqual([]);
  });

  it("populates summary fields (title, tags, linkCount, wordCount)", async () => {
    await writeNote(
      kbPath,
      "rich.md",
      "# Rich Note\n\nHello world #status/active\n\n[[Link Target]]",
    );
    const notes = await listNotes(kbPath);
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

// ---------------------------------------------------------------------------
// Tests for heartbeat-kb-context.ts
// ---------------------------------------------------------------------------

import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveKBContextForHeartbeat } from "./heartbeat-kb-context.js";

let vaultPath: string;

beforeEach(async () => {
  vaultPath = await mkdtemp(path.join(tmpdir(), "hb-kb-"));
});

afterEach(async () => {
  await rm(vaultPath, { recursive: true, force: true });
});

async function writeTestNote(name: string, content: string): Promise<void> {
  await writeFile(path.join(vaultPath, name), content, "utf-8");
}

describe("resolveKBContextForHeartbeat", () => {
  it("returns null when vaultPath is undefined", async () => {
    const result = await resolveKBContextForHeartbeat(undefined);
    expect(result).toBeNull();
  });

  it("returns null when knowledge base is empty", async () => {
    const result = await resolveKBContextForHeartbeat(vaultPath);
    expect(result).toBeNull();
  });

  it("returns null when vault path does not exist", async () => {
    const result = await resolveKBContextForHeartbeat("/nonexistent/path");
    expect(result).toBeNull();
  });

  it("returns summary for recent notes", async () => {
    await writeTestNote("note1.md", "# Note One\n\nSome content");
    await writeTestNote("note2.md", "# Note Two\n\nMore content");

    const result = await resolveKBContextForHeartbeat(vaultPath);
    expect(result).not.toBeNull();
    expect(result).toContain("Knowledge base");
    expect(result).toContain("2 notes");
  });

  it("includes note titles in summary", async () => {
    await writeTestNote("project.md", "# My Project\n\nDetails here");

    const result = await resolveKBContextForHeartbeat(vaultPath);
    expect(result).not.toBeNull();
    expect(result).toContain("My Project");
  });

  it("includes tags in summary", async () => {
    await writeTestNote("tagged.md", "# Tagged Note\n\nContent #important #review");

    const result = await resolveKBContextForHeartbeat(vaultPath);
    expect(result).not.toBeNull();
    expect(result).toContain("important");
  });

  it("includes knowledge base usage instruction", async () => {
    await writeTestNote("note.md", "# Note\n\nText");

    const result = await resolveKBContextForHeartbeat(vaultPath);
    expect(result).not.toBeNull();
    expect(result).toContain("knowledge base notes");
  });

  it("limits to max recent notes", async () => {
    for (let i = 0; i < 10; i++) {
      await writeTestNote(`note${i}.md`, `# Note ${i}\n\nContent ${i}`);
    }

    const result = await resolveKBContextForHeartbeat(vaultPath);
    expect(result).not.toBeNull();
    expect(result).toContain("10 notes");
  });

  it("handles subdirectories", async () => {
    await mkdir(path.join(vaultPath, "sub"), { recursive: true });
    await writeTestNote("sub/nested.md", "# Nested\n\nNested content");

    const result = await resolveKBContextForHeartbeat(vaultPath);
    expect(result).not.toBeNull();
    expect(result).toContain("Nested");
  });

  it("skips hidden files", async () => {
    await writeTestNote(".hidden.md", "# Hidden\n\nShould not appear");
    await writeTestNote("visible.md", "# Visible\n\nShould appear");

    const result = await resolveKBContextForHeartbeat(vaultPath);
    expect(result).not.toBeNull();
    expect(result).not.toContain("Hidden");
    expect(result).toContain("Visible");
  });

  it("shows time ago format", async () => {
    await writeTestNote("recent.md", "# Recent\n\nJust created");

    const result = await resolveKBContextForHeartbeat(vaultPath);
    expect(result).not.toBeNull();
    expect(result).toMatch(/\d+[mhd] ago/);
  });
});

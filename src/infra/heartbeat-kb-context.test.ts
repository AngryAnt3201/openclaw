// ---------------------------------------------------------------------------
// Tests for heartbeat-kb-context.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { KBNoteSummary } from "../knowledge-base/types.js";

// Mock the knowledge-base store since it may not exist yet
vi.mock("../knowledge-base/store.js", () => ({
  listNotes: vi.fn().mockResolvedValue([]),
}));

import { resolveKBContextForHeartbeat } from "./heartbeat-kb-context.js";
import { listNotes } from "../knowledge-base/store.js";

const mockListNotes = vi.mocked(listNotes);

function makeSummary(overrides: Partial<KBNoteSummary> = {}): KBNoteSummary {
  return {
    path: "note.md",
    title: "Test Note",
    tags: [],
    linkCount: 0,
    wordCount: 100,
    createdAtMs: Date.now() - 60_000,
    updatedAtMs: Date.now() - 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  mockListNotes.mockReset();
  mockListNotes.mockResolvedValue([]);
});

describe("resolveKBContextForHeartbeat", () => {
  it("returns null when kbPath is undefined", async () => {
    const result = await resolveKBContextForHeartbeat(undefined);
    expect(result).toBeNull();
  });

  it("returns null when knowledge base is empty", async () => {
    mockListNotes.mockResolvedValue([]);
    const result = await resolveKBContextForHeartbeat("/some/path");
    expect(result).toBeNull();
  });

  it("returns null when listNotes throws", async () => {
    mockListNotes.mockRejectedValue(new Error("read failed"));
    const result = await resolveKBContextForHeartbeat("/nonexistent/path");
    expect(result).toBeNull();
  });

  it("returns summary for recent notes", async () => {
    mockListNotes.mockResolvedValue([
      makeSummary({ path: "note1.md", title: "Note One" }),
      makeSummary({ path: "note2.md", title: "Note Two" }),
    ]);

    const result = await resolveKBContextForHeartbeat("/some/path");
    expect(result).not.toBeNull();
    expect(result).toContain("Knowledge base");
    expect(result).toContain("2 notes");
  });

  it("includes note titles in summary", async () => {
    mockListNotes.mockResolvedValue([
      makeSummary({ title: "My Project" }),
    ]);

    const result = await resolveKBContextForHeartbeat("/some/path");
    expect(result).not.toBeNull();
    expect(result).toContain("My Project");
  });

  it("includes tags in summary", async () => {
    mockListNotes.mockResolvedValue([
      makeSummary({ title: "Tagged Note", tags: ["important", "review"] }),
    ]);

    const result = await resolveKBContextForHeartbeat("/some/path");
    expect(result).not.toBeNull();
    expect(result).toContain("important");
    expect(result).toContain("review");
  });

  it("includes knowledge base usage instruction", async () => {
    mockListNotes.mockResolvedValue([
      makeSummary({ title: "Note" }),
    ]);

    const result = await resolveKBContextForHeartbeat("/some/path");
    expect(result).not.toBeNull();
    expect(result).toContain("knowledge base notes");
  });

  it("limits to max recent notes", async () => {
    const notes = Array.from({ length: 10 }, (_, i) =>
      makeSummary({ path: `note${i}.md`, title: `Note ${i}` }),
    );
    mockListNotes.mockResolvedValue(notes);

    const result = await resolveKBContextForHeartbeat("/some/path");
    expect(result).not.toBeNull();
    // Should contain total count
    expect(result).toContain("10 notes");
    // Should only list 5 recently updated
    expect(result).toContain("5 recently updated");
  });

  it("filters out notes older than 24 hours", async () => {
    const oldMs = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    mockListNotes.mockResolvedValue([
      makeSummary({ title: "Old Note", updatedAtMs: oldMs }),
    ]);

    const result = await resolveKBContextForHeartbeat("/some/path");
    expect(result).toBeNull();
  });

  it("shows time ago format", async () => {
    mockListNotes.mockResolvedValue([
      makeSummary({ title: "Recent", updatedAtMs: Date.now() - 60_000 }),
    ]);

    const result = await resolveKBContextForHeartbeat("/some/path");
    expect(result).not.toBeNull();
    // Should contain a time-ago string like "1m ago"
    expect(result).toMatch(/\d+[mhd] ago/);
  });

  it("sorts notes by most recently updated", async () => {
    const now = Date.now();
    mockListNotes.mockResolvedValue([
      makeSummary({ title: "Older", updatedAtMs: now - 3_600_000 }),
      makeSummary({ title: "Newest", updatedAtMs: now - 60_000 }),
      makeSummary({ title: "Middle", updatedAtMs: now - 1_800_000 }),
    ]);

    const result = await resolveKBContextForHeartbeat("/some/path");
    expect(result).not.toBeNull();
    const newestIdx = result!.indexOf("Newest");
    const middleIdx = result!.indexOf("Middle");
    const olderIdx = result!.indexOf("Older");
    expect(newestIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(olderIdx);
  });
});

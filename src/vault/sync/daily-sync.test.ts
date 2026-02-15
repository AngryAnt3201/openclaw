import { describe, expect, it, vi } from "vitest";
import type { VaultService } from "../service.js";
import type { VaultNote } from "../types.js";
import { appendToDailyNote, appendMultipleToDailyNote, type DailyEntry } from "./daily-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDailyNote(content: string, notePath = "_system/daily/2026-02-15.md"): VaultNote {
  return {
    path: notePath,
    title: "2026-02-15",
    content,
    metadata: {
      frontmatter: {},
      headings: [],
      links: [],
      tags: [],
      wordCount: 0,
    },
    createdAtMs: 1000000,
    updatedAtMs: 2000000,
    sizeBytes: content.length,
  };
}

function mockVaultService(dailyNote?: VaultNote) {
  return {
    getDailyNote: vi.fn().mockResolvedValue(dailyNote ?? makeDailyNote("# 2026-02-15\n\n")),
    update: vi.fn().mockResolvedValue(null),
  } as unknown as VaultService & {
    getDailyNote: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests – appendToDailyNote
// ---------------------------------------------------------------------------

describe("appendToDailyNote", () => {
  // -----------------------------------------------------------------------
  // 1. Appends entry to daily note
  // -----------------------------------------------------------------------

  it("appends an entry to the daily note", async () => {
    const vs = mockVaultService();
    const entry: DailyEntry = { time: "09:00", text: "Started work" };

    await appendToDailyNote(vs, entry);

    expect(vs.update).toHaveBeenCalledTimes(1);
    const [updatedPath, patch] = vs.update.mock.calls[0]!;
    expect(updatedPath).toBe("_system/daily/2026-02-15.md");
    expect(patch.content).toContain("Started work");
  });

  // -----------------------------------------------------------------------
  // 2. Entry format: "- **time** — text"
  // -----------------------------------------------------------------------

  it("formats entry as '- **time** — text'", async () => {
    const vs = mockVaultService();
    const entry: DailyEntry = { time: "14:30", text: "Deployed feature" };

    await appendToDailyNote(vs, entry);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("- **14:30** \u2014 Deployed feature");
  });

  // -----------------------------------------------------------------------
  // 3. Entry with tags appends #tag
  // -----------------------------------------------------------------------

  it("appends tags as hashtags after the entry text", async () => {
    const vs = mockVaultService();
    const entry: DailyEntry = {
      time: "10:00",
      text: "Fixed bug",
      tags: ["bugfix"],
    };

    await appendToDailyNote(vs, entry);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("- **10:00** \u2014 Fixed bug #bugfix");
  });

  // -----------------------------------------------------------------------
  // 4. Creates daily note via getDailyNote if missing
  // -----------------------------------------------------------------------

  it("calls getDailyNote to create the note if it does not exist", async () => {
    const vs = mockVaultService();
    const entry: DailyEntry = { time: "08:00", text: "Morning check" };

    await appendToDailyNote(vs, entry);

    expect(vs.getDailyNote).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 5. Handles content ending with newline
  // -----------------------------------------------------------------------

  it("does not add an extra newline when content already ends with one", async () => {
    const vs = mockVaultService(makeDailyNote("# 2026-02-15\n\n"));
    const entry: DailyEntry = { time: "09:00", text: "Entry" };

    await appendToDailyNote(vs, entry);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    // Content already ends with \n so no extra separator
    expect(patch.content).toBe("# 2026-02-15\n\n- **09:00** \u2014 Entry\n");
  });

  // -----------------------------------------------------------------------
  // 6. Handles content not ending with newline
  // -----------------------------------------------------------------------

  it("adds a newline separator when content does not end with one", async () => {
    const vs = mockVaultService(makeDailyNote("# 2026-02-15"));
    const entry: DailyEntry = { time: "09:00", text: "Entry" };

    await appendToDailyNote(vs, entry);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    // Should insert \n before the entry
    expect(patch.content).toBe("# 2026-02-15\n- **09:00** \u2014 Entry\n");
  });

  // -----------------------------------------------------------------------
  // 7. Passes dateStr to getDailyNote
  // -----------------------------------------------------------------------

  it("passes dateStr to getDailyNote when provided", async () => {
    const vs = mockVaultService();
    const entry: DailyEntry = { time: "09:00", text: "Entry" };

    await appendToDailyNote(vs, entry, "2026-01-01");

    expect(vs.getDailyNote).toHaveBeenCalledWith("2026-01-01");
  });

  // -----------------------------------------------------------------------
  // 8. Multiple tags in entry
  // -----------------------------------------------------------------------

  it("appends multiple tags space-separated", async () => {
    const vs = mockVaultService();
    const entry: DailyEntry = {
      time: "11:00",
      text: "Reviewed PR",
      tags: ["review", "frontend", "urgent"],
    };

    await appendToDailyNote(vs, entry);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("- **11:00** \u2014 Reviewed PR #review #frontend #urgent");
  });
});

// ---------------------------------------------------------------------------
// Tests – appendMultipleToDailyNote
// ---------------------------------------------------------------------------

describe("appendMultipleToDailyNote", () => {
  // -----------------------------------------------------------------------
  // 9. Appends multiple entries at once
  // -----------------------------------------------------------------------

  it("appends multiple entries to the daily note", async () => {
    const vs = mockVaultService();
    const entries: DailyEntry[] = [
      { time: "09:00", text: "Started work" },
      { time: "10:00", text: "Had meeting" },
    ];

    await appendMultipleToDailyNote(vs, entries);

    expect(vs.update).toHaveBeenCalledTimes(1);
    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("- **09:00** \u2014 Started work");
    expect(patch.content).toContain("- **10:00** \u2014 Had meeting");
  });

  // -----------------------------------------------------------------------
  // 10. Empty entries array does nothing
  // -----------------------------------------------------------------------

  it("does nothing when entries array is empty", async () => {
    const vs = mockVaultService();

    await appendMultipleToDailyNote(vs, []);

    expect(vs.getDailyNote).not.toHaveBeenCalled();
    expect(vs.update).not.toHaveBeenCalled();
  });
});

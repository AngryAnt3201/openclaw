import { describe, expect, it, vi } from "vitest";
import type { KBService } from "../service.js";
import type { KBNote } from "../types.js";
import { appendToDailyNote, appendMultipleToDailyNote, type DailyEntry } from "./daily-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDailyNote(content: string, notePath = "_miranda/daily/2026-02-15.md"): KBNote {
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

function mockKBService(dailyNote?: KBNote) {
  return {
    get: vi.fn().mockResolvedValue(dailyNote ?? makeDailyNote("# 2026-02-15\n\n")),
    create: vi.fn().mockResolvedValue({}),
  } as unknown as KBService & {
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
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
    const svc = mockKBService();
    const entry: DailyEntry = { time: "09:00", text: "Started work" };

    await appendToDailyNote(svc, entry);

    // get() to read existing, then create() to upsert
    expect(svc.create).toHaveBeenCalled();
    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("Started work");
  });

  // -----------------------------------------------------------------------
  // 2. Entry format: "- **time** — text"
  // -----------------------------------------------------------------------

  it("formats entry as '- **time** — text'", async () => {
    const svc = mockKBService();
    const entry: DailyEntry = { time: "14:30", text: "Deployed feature" };

    await appendToDailyNote(svc, entry);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("- **14:30** \u2014 Deployed feature");
  });

  // -----------------------------------------------------------------------
  // 3. Entry with tags appends #tag
  // -----------------------------------------------------------------------

  it("appends tags as hashtags after the entry text", async () => {
    const svc = mockKBService();
    const entry: DailyEntry = {
      time: "10:00",
      text: "Fixed bug",
      tags: ["bugfix"],
    };

    await appendToDailyNote(svc, entry);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("- **10:00** \u2014 Fixed bug #bugfix");
  });

  // -----------------------------------------------------------------------
  // 4. Gets daily note via get()
  // -----------------------------------------------------------------------

  it("calls get() to read the daily note", async () => {
    const svc = mockKBService();
    const entry: DailyEntry = { time: "08:00", text: "Morning check" };

    await appendToDailyNote(svc, entry);

    expect(svc.get).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 5. Handles content ending with newline
  // -----------------------------------------------------------------------

  it("does not add an extra newline when content already ends with one", async () => {
    const svc = mockKBService(makeDailyNote("# 2026-02-15\n\n"));
    const entry: DailyEntry = { time: "09:00", text: "Entry" };

    await appendToDailyNote(svc, entry);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toBe("# 2026-02-15\n\n- **09:00** \u2014 Entry\n");
  });

  // -----------------------------------------------------------------------
  // 6. Handles content not ending with newline
  // -----------------------------------------------------------------------

  it("adds a newline separator when content does not end with one", async () => {
    const svc = mockKBService(makeDailyNote("# 2026-02-15"));
    const entry: DailyEntry = { time: "09:00", text: "Entry" };

    await appendToDailyNote(svc, entry);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    // Should insert \n before the entry
    expect(lastCreate.content).toBe("# 2026-02-15\n- **09:00** \u2014 Entry\n");
  });

  // -----------------------------------------------------------------------
  // 7. Passes dateStr to get()
  // -----------------------------------------------------------------------

  it("passes dateStr to get() when provided", async () => {
    const svc = mockKBService();
    const entry: DailyEntry = { time: "09:00", text: "Entry" };

    await appendToDailyNote(svc, entry, "2026-01-01");

    expect(svc.get).toHaveBeenCalledWith("_miranda/daily/2026-01-01.md");
  });

  // -----------------------------------------------------------------------
  // 8. Multiple tags in entry
  // -----------------------------------------------------------------------

  it("appends multiple tags space-separated", async () => {
    const svc = mockKBService();
    const entry: DailyEntry = {
      time: "11:00",
      text: "Reviewed PR",
      tags: ["review", "frontend", "urgent"],
    };

    await appendToDailyNote(svc, entry);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain(
      "- **11:00** \u2014 Reviewed PR #review #frontend #urgent",
    );
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
    const svc = mockKBService();
    const entries: DailyEntry[] = [
      { time: "09:00", text: "Started work" },
      { time: "10:00", text: "Had meeting" },
    ];

    await appendMultipleToDailyNote(svc, entries);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("- **09:00** \u2014 Started work");
    expect(lastCreate.content).toContain("- **10:00** \u2014 Had meeting");
  });

  // -----------------------------------------------------------------------
  // 10. Empty entries array does nothing
  // -----------------------------------------------------------------------

  it("does nothing when entries array is empty", async () => {
    const svc = mockKBService();

    await appendMultipleToDailyNote(svc, []);

    expect(svc.get).not.toHaveBeenCalled();
    expect(svc.create).not.toHaveBeenCalled();
  });
});

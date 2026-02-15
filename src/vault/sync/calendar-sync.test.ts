import { describe, expect, it, vi } from "vitest";
import type { VaultService } from "../service.js";
import type { VaultNote } from "../types.js";
import {
  syncCalendarEventsToVault,
  syncCalendarEventToVault,
  type CalendarEvent,
} from "./calendar-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDailyNote(content: string): VaultNote {
  return {
    path: "_system/daily/2026-02-15.md",
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

function mockVaultService() {
  return {
    getDailyNote: vi.fn().mockResolvedValue(makeDailyNote("# 2026-02-15\n\n")),
    update: vi.fn().mockResolvedValue(null),
  } as unknown as VaultService & {
    getDailyNote: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function mockEvent(overrides?: Partial<CalendarEvent>): CalendarEvent {
  return {
    title: "Team Standup",
    startTime: "09:00",
    endTime: "09:15",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncCalendarEventsToVault", () => {
  it("does nothing when events array is empty", async () => {
    const vs = mockVaultService();

    await syncCalendarEventsToVault([], vs);

    expect(vs.getDailyNote).not.toHaveBeenCalled();
    expect(vs.update).not.toHaveBeenCalled();
  });

  it("appends a single event to the daily note", async () => {
    const vs = mockVaultService();

    await syncCalendarEventsToVault([mockEvent()], vs);

    expect(vs.update).toHaveBeenCalledTimes(1);
    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("Team Standup");
  });

  it("formats time as start–end range", async () => {
    const vs = mockVaultService();

    await syncCalendarEventsToVault([mockEvent({ startTime: "14:00", endTime: "15:30" })], vs);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("**14:00–15:30**");
  });

  it("uses start time only when no end time", async () => {
    const vs = mockVaultService();

    await syncCalendarEventsToVault([mockEvent({ endTime: undefined })], vs);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("**09:00**");
    expect(patch.content).not.toContain("–");
  });

  it("uses 'All day' for all-day events", async () => {
    const vs = mockVaultService();

    await syncCalendarEventsToVault([mockEvent({ isAllDay: true })], vs);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("**All day**");
  });

  it("includes location when provided", async () => {
    const vs = mockVaultService();

    await syncCalendarEventsToVault([mockEvent({ location: "Zoom Room 1" })], vs);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("Team Standup @ Zoom Room 1");
  });

  it("appends multiple events in one update", async () => {
    const vs = mockVaultService();

    await syncCalendarEventsToVault(
      [
        mockEvent({ title: "Standup", startTime: "09:00" }),
        mockEvent({ title: "Sprint Review", startTime: "14:00", endTime: "15:00" }),
      ],
      vs,
    );

    expect(vs.update).toHaveBeenCalledTimes(1);
    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("Standup");
    expect(patch.content).toContain("Sprint Review");
  });

  it("includes tags when provided", async () => {
    const vs = mockVaultService();

    await syncCalendarEventsToVault([mockEvent({ tags: ["meeting", "daily"] })], vs);

    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("#meeting");
    expect(patch.content).toContain("#daily");
  });

  it("passes dateStr to getDailyNote", async () => {
    const vs = mockVaultService();

    await syncCalendarEventsToVault([mockEvent()], vs, "2026-03-01");

    expect(vs.getDailyNote).toHaveBeenCalledWith("2026-03-01");
  });
});

describe("syncCalendarEventToVault", () => {
  it("syncs a single event by delegating to batch function", async () => {
    const vs = mockVaultService();

    await syncCalendarEventToVault(mockEvent(), vs);

    expect(vs.update).toHaveBeenCalledTimes(1);
    const patch = vs.update.mock.calls[0]![1] as { content: string };
    expect(patch.content).toContain("Team Standup");
  });
});

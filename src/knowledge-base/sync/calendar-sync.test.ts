import { describe, expect, it, vi } from "vitest";
import type { KBService } from "../service.js";
import type { KBNote } from "../types.js";
import {
  syncCalendarEventsToKB,
  syncCalendarEventToKB,
  type CalendarEvent,
} from "./calendar-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDailyNote(content: string): KBNote {
  return {
    path: "_miranda/daily/2026-02-15.md",
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

function mockKBService() {
  return {
    get: vi.fn().mockResolvedValue(makeDailyNote("# 2026-02-15\n\n")),
    create: vi.fn().mockResolvedValue({}),
  } as unknown as KBService & {
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
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

describe("syncCalendarEventsToKB", () => {
  it("does nothing when events array is empty", async () => {
    const svc = mockKBService();

    await syncCalendarEventsToKB([], svc);

    expect(svc.get).not.toHaveBeenCalled();
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("appends a single event to the daily note", async () => {
    const svc = mockKBService();

    await syncCalendarEventsToKB([mockEvent()], svc);

    // get() to read existing, then create() to upsert
    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("Team Standup");
  });

  it("formats time as start-end range", async () => {
    const svc = mockKBService();

    await syncCalendarEventsToKB([mockEvent({ startTime: "14:00", endTime: "15:30" })], svc);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("**14:00\u201315:30**");
  });

  it("uses start time only when no end time", async () => {
    const svc = mockKBService();

    await syncCalendarEventsToKB([mockEvent({ endTime: undefined })], svc);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("**09:00**");
    expect(lastCreate.content).not.toContain("\u2013");
  });

  it("uses 'All day' for all-day events", async () => {
    const svc = mockKBService();

    await syncCalendarEventsToKB([mockEvent({ isAllDay: true })], svc);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("**All day**");
  });

  it("includes location when provided", async () => {
    const svc = mockKBService();

    await syncCalendarEventsToKB([mockEvent({ location: "Zoom Room 1" })], svc);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("Team Standup @ Zoom Room 1");
  });

  it("appends multiple events in one update", async () => {
    const svc = mockKBService();

    await syncCalendarEventsToKB(
      [
        mockEvent({ title: "Standup", startTime: "09:00" }),
        mockEvent({ title: "Sprint Review", startTime: "14:00", endTime: "15:00" }),
      ],
      svc,
    );

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("Standup");
    expect(lastCreate.content).toContain("Sprint Review");
  });

  it("includes tags when provided", async () => {
    const svc = mockKBService();

    await syncCalendarEventsToKB([mockEvent({ tags: ["meeting", "daily"] })], svc);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("#meeting");
    expect(lastCreate.content).toContain("#daily");
  });

  it("passes dateStr to get()", async () => {
    const svc = mockKBService();

    await syncCalendarEventsToKB([mockEvent()], svc, "2026-03-01");

    expect(svc.get).toHaveBeenCalledWith("_miranda/daily/2026-03-01.md");
  });
});

describe("syncCalendarEventToKB", () => {
  it("syncs a single event by delegating to batch function", async () => {
    const svc = mockKBService();

    await syncCalendarEventToKB(mockEvent(), svc);

    const lastCreate = svc.create.mock.calls[svc.create.mock.calls.length - 1]![0] as {
      content: string;
    };
    expect(lastCreate.content).toContain("Team Standup");
  });
});

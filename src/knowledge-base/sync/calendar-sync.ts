// ---------------------------------------------------------------------------
// Calendar → KB Sync – injects calendar events into daily notes
// ---------------------------------------------------------------------------

import type { KBService } from "../service.js";
import { appendMultipleToDailyNote, type DailyEntry } from "./daily-sync.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalendarEvent = {
  title: string;
  startTime: string; // HH:MM format
  endTime?: string; // HH:MM format
  location?: string;
  description?: string;
  isAllDay?: boolean;
  tags?: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEventEntry(event: CalendarEvent): DailyEntry {
  const timePart = event.isAllDay
    ? "All day"
    : event.endTime
      ? `${event.startTime}–${event.endTime}`
      : event.startTime;

  let text = event.title;
  if (event.location) {
    text += ` @ ${event.location}`;
  }

  return {
    time: timePart,
    text,
    tags: event.tags,
  };
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

/**
 * Sync a list of calendar events into a daily note.
 * Events are appended as activity entries under a "## Calendar" heading.
 */
export async function syncCalendarEventsToKB(
  events: CalendarEvent[],
  kbService: KBService,
  dateStr?: string,
): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const entries = events.map(formatEventEntry);
  await appendMultipleToDailyNote(kbService, entries, dateStr);
}

/**
 * Sync a single calendar event into a daily note.
 */
export async function syncCalendarEventToKB(
  event: CalendarEvent,
  kbService: KBService,
  dateStr?: string,
): Promise<void> {
  await syncCalendarEventsToKB([event], kbService, dateStr);
}

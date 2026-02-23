// ---------------------------------------------------------------------------
// Daily Note Sync – appends activity entries to today's daily note
// ---------------------------------------------------------------------------

import type { KBService } from "../service.js";

const DAILY_NOTE_PREFIX = "_miranda/daily";

export type DailyEntry = {
  time: string;
  text: string;
  tags?: string[];
};

function formatEntry(entry: DailyEntry): string {
  const tags = entry.tags?.map((t) => ` #${t}`).join("") ?? "";
  return `- **${entry.time}** — ${entry.text}${tags}`;
}

function dailyNotePath(dateStr?: string): string {
  const date = dateStr ?? new Date().toISOString().slice(0, 10);
  return `${DAILY_NOTE_PREFIX}/${date}.md`;
}

/**
 * Get or create a daily note via KBService.
 * KBService has no dedicated getDailyNote — we use get() + create().
 */
async function getOrCreateDailyNote(
  kbService: KBService,
  dateStr?: string,
): Promise<{ path: string; content: string }> {
  const notePath = dailyNotePath(dateStr);
  const existing = await kbService.get(notePath);
  if (existing) {
    return { path: existing.path, content: existing.content };
  }

  // Create a new daily note with a heading
  const date = dateStr ?? new Date().toISOString().slice(0, 10);
  const content = `# ${date}\n\n`;
  await kbService.create({ path: notePath, content });
  return { path: notePath, content };
}

/**
 * Append an activity entry to today's daily note.
 * Creates the daily note if it doesn't exist yet.
 */
export async function appendToDailyNote(
  kbService: KBService,
  entry: DailyEntry,
  dateStr?: string,
): Promise<void> {
  const dailyNote = await getOrCreateDailyNote(kbService, dateStr);
  const newLine = formatEntry(entry);

  // Append to existing content
  const separator = dailyNote.content.endsWith("\n") ? "" : "\n";
  const updatedContent = dailyNote.content + separator + newLine + "\n";

  // KBService.create() is upsert – it overwrites if the note already exists
  await kbService.create({ path: dailyNote.path, content: updatedContent });
}

/**
 * Append multiple entries at once (batch operation).
 */
export async function appendMultipleToDailyNote(
  kbService: KBService,
  entries: DailyEntry[],
  dateStr?: string,
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const dailyNote = await getOrCreateDailyNote(kbService, dateStr);
  const newLines = entries.map(formatEntry).join("\n");

  const separator = dailyNote.content.endsWith("\n") ? "" : "\n";
  const updatedContent = dailyNote.content + separator + newLines + "\n";

  // KBService.create() is upsert – it overwrites if the note already exists
  await kbService.create({ path: dailyNote.path, content: updatedContent });
}

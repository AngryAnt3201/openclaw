// ---------------------------------------------------------------------------
// Daily Note Sync – appends activity entries to today's daily note
// ---------------------------------------------------------------------------

import type { VaultService } from "../service.js";

export type DailyEntry = {
  time: string;
  text: string;
  tags?: string[];
};

function formatEntry(entry: DailyEntry): string {
  const tags = entry.tags?.map((t) => ` #${t}`).join("") ?? "";
  return `- **${entry.time}** — ${entry.text}${tags}`;
}

/**
 * Append an activity entry to today's daily note.
 * Creates the daily note if it doesn't exist yet.
 */
export async function appendToDailyNote(
  vaultService: VaultService,
  entry: DailyEntry,
  dateStr?: string,
): Promise<void> {
  const dailyNote = await vaultService.getDailyNote(dateStr);
  const newLine = formatEntry(entry);

  // Append to existing content
  const separator = dailyNote.content.endsWith("\n") ? "" : "\n";
  const updatedContent = dailyNote.content + separator + newLine + "\n";

  await vaultService.update(dailyNote.path, { content: updatedContent });
}

/**
 * Append multiple entries at once (batch operation).
 */
export async function appendMultipleToDailyNote(
  vaultService: VaultService,
  entries: DailyEntry[],
  dateStr?: string,
): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const dailyNote = await vaultService.getDailyNote(dateStr);
  const newLines = entries.map(formatEntry).join("\n");

  const separator = dailyNote.content.endsWith("\n") ? "" : "\n";
  const updatedContent = dailyNote.content + separator + newLines + "\n";

  await vaultService.update(dailyNote.path, { content: updatedContent });
}

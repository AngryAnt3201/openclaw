// ---------------------------------------------------------------------------
// Heartbeat KB Context – provides recent knowledge base activity for heartbeat prompt
// ---------------------------------------------------------------------------
// Reads the connected knowledge base and formats a summary of recent notes
// so the heartbeat agent has visibility into knowledge base activity.
// ---------------------------------------------------------------------------

import { listNotes } from "../knowledge-base/store.js";

const MAX_RECENT_NOTES = 5;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Read the knowledge base and return a formatted summary of recent activity.
 * Returns `null` if no recent notes or vault path is not configured.
 */
export async function resolveKBContextForHeartbeat(
  vaultPath: string | undefined,
): Promise<string | null> {
  if (!vaultPath) {
    return null;
  }

  try {
    const allNotes = await listNotes(vaultPath);
    const now = Date.now();
    const recentNotes = allNotes
      .filter((n) => now - n.updatedAtMs < RECENT_WINDOW_MS)
      .toSorted((a, b) => b.updatedAtMs - a.updatedAtMs)
      .slice(0, MAX_RECENT_NOTES);

    if (recentNotes.length === 0) {
      return null;
    }

    const lines = recentNotes.map((n) => {
      const ago = formatTimeAgo(now - n.updatedAtMs);
      const tags = n.tags.length > 0 ? ` [${n.tags.join(", ")}]` : "";
      return `- "${n.title}" (${ago})${tags}`;
    });

    const totalNotes = allNotes.length;

    return (
      `\n\nKnowledge base (${totalNotes} notes, ${recentNotes.length} recently updated):\n` +
      lines.join("\n") +
      "\n\nYou can create knowledge base notes to persist important information."
    );
  } catch {
    return null;
  }
}

function formatTimeAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

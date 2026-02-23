// ---------------------------------------------------------------------------
// Browser Clip → KB Sync – saves web clips as KB notes
// ---------------------------------------------------------------------------

import type { KBService } from "../service.js";
import { serializeFrontmatter } from "../metadata-parser.js";

const CLIP_NOTE_PREFIX = "_miranda/clips";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BrowserClip = {
  url: string;
  title: string;
  content: string;
  clippedAtMs: number;
  sessionId?: string;
  taskId?: string;
  tags?: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function clipNotePath(title: string, date: string): string {
  const slug = slugify(title);
  return `${CLIP_NOTE_PREFIX}/CLIP-${date}-${slug}.md`;
}

function formatClipBody(clip: BrowserClip): string {
  const lines: string[] = [];

  lines.push(`# ${clip.title}`);
  lines.push("");
  lines.push(`> Clipped from [${new URL(clip.url).hostname}](${clip.url})`);

  if (clip.sessionId) {
    lines.push(`> During [[SESSION-${clip.sessionId.slice(0, 8)}]]`);
  }

  lines.push("");
  lines.push("## Content");
  lines.push("");
  lines.push(clip.content);
  lines.push("");

  // Related section
  const related: string[] = [];
  if (clip.taskId) {
    related.push(`- Task: [[TASK-${clip.taskId.slice(0, 8)}]]`);
  }
  if (clip.sessionId) {
    related.push(`- Session: [[SESSION-${clip.sessionId.slice(0, 8)}]]`);
  }

  if (related.length > 0) {
    lines.push("## Related");
    lines.push("");
    lines.push(...related);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

export async function syncBrowserClipToKB(clip: BrowserClip, kbService: KBService): Promise<void> {
  const date = new Date(clip.clippedAtMs).toISOString().slice(0, 10);
  const notePath = clipNotePath(clip.title, date);

  const frontmatter: Record<string, unknown> = {
    type: "clip",
    url: clip.url,
    title: clip.title,
    clippedAt: new Date(clip.clippedAtMs).toISOString(),
    tags: ["clip", ...(clip.tags ?? [])],
  };

  if (clip.sessionId) {
    frontmatter.sessionId = clip.sessionId;
  }
  if (clip.taskId) {
    frontmatter.taskId = clip.taskId;
  }

  const body = formatClipBody(clip);
  const content = serializeFrontmatter(frontmatter, body);

  // KBService.create() is upsert – it overwrites if the note already exists
  await kbService.create({ path: notePath, content });
}

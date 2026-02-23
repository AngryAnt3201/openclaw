// ---------------------------------------------------------------------------
// KB Metadata Parser – extracts structured metadata from markdown content
// ---------------------------------------------------------------------------

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { KBHeading, KBLink, KBNoteMetadata, KBTag } from "./types.js";

// ---------------------------------------------------------------------------
// Code fence detection (skip wikilinks/tags inside fenced code blocks)
// ---------------------------------------------------------------------------

type LineRange = { start: number; end: number };

function findCodeFenceRanges(content: string): LineRange[] {
  const ranges: LineRange[] = [];
  const lines = content.split("\n");
  let inFence = false;
  let fenceStart = 0;
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      if (!inFence) {
        inFence = true;
        fenceStart = offset;
      } else {
        ranges.push({ start: fenceStart, end: offset + line.length });
        inFence = false;
      }
    }
    offset += line.length + 1; // +1 for newline
  }

  // If still in fence at EOF, treat rest as fenced
  if (inFence) {
    ranges.push({ start: fenceStart, end: content.length });
  }

  return ranges;
}

function isInsideCodeFence(pos: number, ranges: LineRange[]): boolean {
  for (const r of ranges) {
    if (pos >= r.start && pos <= r.end) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export function extractFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  try {
    const parsed = parseYaml(match[1]!) as Record<string, unknown>;
    const body = content.slice(match[0]!.length);
    return {
      frontmatter: parsed && typeof parsed === "object" ? parsed : {},
      body,
    };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  if (Object.keys(frontmatter).length === 0) {
    return body;
  }
  const yamlStr = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yamlStr}\n---\n${body}`;
}

// ---------------------------------------------------------------------------
// Wikilinks
// ---------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function extractWikilinks(content: string): KBLink[] {
  const fenceRanges = findCodeFenceRanges(content);
  const links: KBLink[] = [];
  let match: RegExpExecArray | null;

  while ((match = WIKILINK_RE.exec(content)) !== null) {
    if (isInsideCodeFence(match.index, fenceRanges)) {
      continue;
    }

    const before = content.slice(0, match.index);
    const line = before.split("\n").length;
    const lastNewline = before.lastIndexOf("\n");
    const col = match.index - (lastNewline === -1 ? 0 : lastNewline + 1);

    links.push({
      target: match[1]!.trim(),
      alias: match[2]?.trim(),
      position: { line, col },
    });
  }

  return links;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

const TAG_RE = /(?:^|\s)#([\w/-]+)/g;

export function extractTags(content: string): KBTag[] {
  const fenceRanges = findCodeFenceRanges(content);
  const tags: KBTag[] = [];
  let match: RegExpExecArray | null;

  while ((match = TAG_RE.exec(content)) !== null) {
    if (isInsideCodeFence(match.index, fenceRanges)) {
      continue;
    }

    // The tag starts after the space/newline
    const tagStart = match.index + match[0]!.indexOf("#");
    const before = content.slice(0, tagStart);
    const line = before.split("\n").length;
    const lastNewline = before.lastIndexOf("\n");
    const col = tagStart - (lastNewline === -1 ? 0 : lastNewline + 1);

    tags.push({
      name: match[1]!,
      position: { line, col },
    });
  }

  return tags;
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;

export function extractHeadings(content: string): KBHeading[] {
  const headings: KBHeading[] = [];
  let match: RegExpExecArray | null;

  while ((match = HEADING_RE.exec(content)) !== null) {
    const before = content.slice(0, match.index);
    const line = before.split("\n").length;

    headings.push({
      level: match[1]!.length,
      text: match[2]!.trim(),
      line,
    });
  }

  return headings;
}

// ---------------------------------------------------------------------------
// Word count
// ---------------------------------------------------------------------------

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// Full parse
// ---------------------------------------------------------------------------

export function parseNoteMetadata(content: string): KBNoteMetadata {
  const { frontmatter, body } = extractFrontmatter(content);
  return {
    frontmatter,
    headings: extractHeadings(body),
    links: extractWikilinks(body),
    tags: extractTags(body),
    wordCount: countWords(body),
  };
}

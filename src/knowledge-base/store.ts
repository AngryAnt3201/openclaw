// ---------------------------------------------------------------------------
// Knowledge Base Store – recursive markdown scanner
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { KBNoteSummary } from "./types.js";
import {
  extractFrontmatter,
  extractTags,
  extractHeadings,
  extractWikilinks,
} from "../vault/metadata-parser.js";

const DEFAULT_KB_DIR = ".miranda/knowledge-base";

/** Directories to skip when walking the vault. */
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules", ".DS_Store"]);

/**
 * Resolve the knowledge base path from a custom string or default location.
 */
export function resolveKBPath(custom?: string): string {
  if (custom) {
    return path.resolve(custom);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_KB_DIR);
}

/**
 * Recursively walk a directory yielding `.md` file paths (relative to root).
 */
async function walkDir(root: string, dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const name = entry.name;
    // Skip hidden dirs/files (starting with .) and known skip dirs
    if (name.startsWith(".") || SKIP_DIRS.has(name)) {
      continue;
    }

    const fullPath = path.join(dir, name);
    if (entry.isDirectory()) {
      const sub = await walkDir(root, fullPath);
      results.push(...sub);
    } else if (entry.isFile() && name.endsWith(".md")) {
      results.push(path.relative(root, fullPath));
    }
  }

  return results;
}

/**
 * List all markdown notes in the knowledge base (recursive).
 * Extracts title, tags, and stat info from each file.
 */
export async function listNotes(kbPath: string, folder?: string): Promise<KBNoteSummary[]> {
  const scanRoot = folder ? path.join(kbPath, folder) : kbPath;
  const relativePaths = await walkDir(kbPath, scanRoot);
  const notes: KBNoteSummary[] = [];

  for (const relPath of relativePaths) {
    const fullPath = path.join(kbPath, relPath);
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(fullPath, "utf-8"),
        fs.stat(fullPath),
      ]);

      const { frontmatter, body } = extractFrontmatter(content);
      const headings = extractHeadings(body);
      const inlineTags = extractTags(body).map((t) => t.name);

      // Frontmatter tags: support both string[] and comma-separated string
      const fmTags: string[] = [];
      const rawTags = frontmatter.tags;
      if (Array.isArray(rawTags)) {
        for (const t of rawTags) {
          if (typeof t === "string") {
            fmTags.push(t);
          }
        }
      } else if (typeof rawTags === "string") {
        for (const t of rawTags.split(",")) {
          const trimmed = t.trim();
          if (trimmed) {
            fmTags.push(trimmed);
          }
        }
      }

      // Merge and dedupe tags
      const tags = [...new Set([...fmTags, ...inlineTags])];

      // Extract wikilink targets for graph edges
      const links = extractWikilinks(body).map((l) => l.target);

      // Title: first H1 > frontmatter title > filename
      const h1 = headings.find((h) => h.level === 1);
      const title =
        h1?.text ??
        (typeof frontmatter.title === "string" ? frontmatter.title : null) ??
        path.basename(relPath, ".md");

      notes.push({
        path: relPath,
        title,
        tags,
        links,
        updatedAtMs: stat.mtimeMs,
        createdAtMs: stat.birthtimeMs,
        sizeBytes: stat.size,
      });
    } catch {
      // Skip files we can't read
    }
  }

  return notes;
}

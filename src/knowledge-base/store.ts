// ---------------------------------------------------------------------------
// KB Store – File-based operations for the knowledge base filesystem
// ---------------------------------------------------------------------------
// Unlike TaskStore (single JSON file), the KB IS the filesystem.
// Each note is a .md file; this module provides CRUD operations.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { KBNote, KBNoteSummary } from "./types.js";
import { parseNoteMetadata } from "./metadata-parser.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_KB_DIR = ".miranda/vault";

export function resolveKBPath(custom?: string): string {
  if (custom) {
    return path.resolve(custom);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_KB_DIR);
}

// ---------------------------------------------------------------------------
// Ensure KB structure
// ---------------------------------------------------------------------------

const DEFAULT_SYNC_FOLDER = "_miranda";

function getSystemDirs(syncFolder: string): string[] {
  return [
    `${syncFolder}/tasks`,
    `${syncFolder}/daily`,
    `${syncFolder}/clips`,
    `${syncFolder}/transcripts`,
    `${syncFolder}/calendar`,
    `${syncFolder}/code`,
  ];
}

export async function ensureKBStructure(
  kbPath: string,
  syncFolder: string = DEFAULT_SYNC_FOLDER,
): Promise<void> {
  if (!existsSync(kbPath)) {
    mkdirSync(kbPath, { recursive: true });
  }
  for (const dir of getSystemDirs(syncFolder)) {
    const fullPath = path.join(kbPath, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Read note
// ---------------------------------------------------------------------------

export async function readNote(kbPath: string, notePath: string): Promise<KBNote | null> {
  const fullPath = path.join(kbPath, notePath);
  try {
    const [content, stat] = await Promise.all([fs.readFile(fullPath, "utf-8"), fs.stat(fullPath)]);

    const metadata = parseNoteMetadata(content);
    const title = deriveTitle(notePath, metadata.headings);

    return {
      path: notePath,
      title,
      content,
      metadata,
      createdAtMs: stat.birthtimeMs,
      updatedAtMs: stat.mtimeMs,
      sizeBytes: stat.size,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Write note (atomic: write .tmp then rename)
// ---------------------------------------------------------------------------

export async function writeNote(kbPath: string, notePath: string, content: string): Promise<void> {
  const fullPath = path.join(kbPath, notePath);
  const dir = path.dirname(fullPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = fullPath + ".tmp";
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, fullPath);
}

// ---------------------------------------------------------------------------
// Delete note
// ---------------------------------------------------------------------------

export async function deleteNote(kbPath: string, notePath: string): Promise<boolean> {
  const fullPath = path.join(kbPath, notePath);
  try {
    await fs.unlink(fullPath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// List notes (recursive)
// ---------------------------------------------------------------------------

export async function listNotes(kbPath: string, folder?: string): Promise<KBNoteSummary[]> {
  const scanPath = folder ? path.join(kbPath, folder) : kbPath;
  const summaries: KBNoteSummary[] = [];

  try {
    await walkDir(scanPath, kbPath, summaries);
  } catch {
    // Directory doesn't exist or is inaccessible
  }

  return summaries;
}

async function walkDir(dirPath: string, kbRoot: string, out: KBNoteSummary[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    // Skip hidden files/folders and .obsidian
    if (entry.name.startsWith(".") || entry.name === ".obsidian" || entry.name === ".trash") {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDir(fullPath, kbRoot, out);
    } else if (entry.name.endsWith(".md")) {
      try {
        const [content, stat] = await Promise.all([
          fs.readFile(fullPath, "utf-8"),
          fs.stat(fullPath),
        ]);
        const relPath = path.relative(kbRoot, fullPath);
        const metadata = parseNoteMetadata(content);
        const title = deriveTitle(relPath, metadata.headings);

        out.push({
          path: relPath,
          title,
          tags: metadata.tags.map((t) => t.name),
          linkCount: metadata.links.length,
          wordCount: metadata.wordCount,
          createdAtMs: stat.birthtimeMs,
          updatedAtMs: stat.mtimeMs,
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveTitle(notePath: string, headings: { level: number; text: string }[]): string {
  // Use first H1 heading if available
  const h1 = headings.find((h) => h.level === 1);
  if (h1) {
    return h1.text;
  }

  // Fall back to filename without extension
  return path.basename(notePath, path.extname(notePath));
}

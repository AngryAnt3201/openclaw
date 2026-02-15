// ---------------------------------------------------------------------------
// Vault Store – File-based operations for the vault filesystem
// ---------------------------------------------------------------------------
// Unlike TaskStore (single JSON file), the vault IS the filesystem.
// Each note is a .md file; this module provides CRUD + tree operations.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { VaultNote, VaultNoteSummary, VaultTreeNode } from "./types.js";
import { parseVaultMetadata } from "./metadata-parser.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_VAULT_DIR = ".miranda/vault";

export function resolveVaultPath(custom?: string): string {
  if (custom) {
    return path.resolve(custom);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_VAULT_DIR);
}

// ---------------------------------------------------------------------------
// Ensure vault structure
// ---------------------------------------------------------------------------

const SYSTEM_DIRS = ["_system/tasks", "_system/daily", "_system/templates"];

export async function ensureVaultStructure(vaultPath: string): Promise<void> {
  if (!existsSync(vaultPath)) {
    mkdirSync(vaultPath, { recursive: true });
  }
  for (const dir of SYSTEM_DIRS) {
    const fullPath = path.join(vaultPath, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Read note
// ---------------------------------------------------------------------------

export async function readNote(vaultPath: string, notePath: string): Promise<VaultNote | null> {
  const fullPath = path.join(vaultPath, notePath);
  try {
    const [content, stat] = await Promise.all([fs.readFile(fullPath, "utf-8"), fs.stat(fullPath)]);

    const metadata = parseVaultMetadata(content);
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

export async function writeNote(
  vaultPath: string,
  notePath: string,
  content: string,
): Promise<void> {
  const fullPath = path.join(vaultPath, notePath);
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

export async function deleteNote(vaultPath: string, notePath: string): Promise<boolean> {
  const fullPath = path.join(vaultPath, notePath);
  try {
    await fs.unlink(fullPath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Move note
// ---------------------------------------------------------------------------

export async function moveNote(vaultPath: string, from: string, to: string): Promise<boolean> {
  const srcPath = path.join(vaultPath, from);
  const destPath = path.join(vaultPath, to);
  const destDir = path.dirname(destPath);

  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  try {
    await fs.rename(srcPath, destPath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// List notes (recursive)
// ---------------------------------------------------------------------------

export async function listNotes(vaultPath: string, folder?: string): Promise<VaultNoteSummary[]> {
  const scanPath = folder ? path.join(vaultPath, folder) : vaultPath;
  const summaries: VaultNoteSummary[] = [];

  try {
    await walkDir(scanPath, vaultPath, summaries);
  } catch {
    // Directory doesn't exist or is inaccessible
  }

  return summaries;
}

async function walkDir(dirPath: string, vaultRoot: string, out: VaultNoteSummary[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    // Skip hidden files/folders and .obsidian
    if (entry.name.startsWith(".") || entry.name === ".obsidian" || entry.name === ".trash") {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDir(fullPath, vaultRoot, out);
    } else if (entry.name.endsWith(".md")) {
      try {
        const [content, stat] = await Promise.all([
          fs.readFile(fullPath, "utf-8"),
          fs.stat(fullPath),
        ]);
        const relPath = path.relative(vaultRoot, fullPath);
        const metadata = parseVaultMetadata(content);
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
// Build tree
// ---------------------------------------------------------------------------

export async function buildTree(vaultPath: string): Promise<VaultTreeNode> {
  return buildTreeNode(vaultPath, vaultPath, path.basename(vaultPath));
}

async function buildTreeNode(
  fullPath: string,
  vaultRoot: string,
  name: string,
): Promise<VaultTreeNode> {
  const relPath = path.relative(vaultRoot, fullPath) || ".";

  try {
    const stat = await fs.stat(fullPath);
    if (!stat.isDirectory()) {
      return { name, path: relPath, type: "file" };
    }
  } catch {
    return { name, path: relPath, type: "file" };
  }

  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const children: VaultTreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === ".obsidian" || entry.name === ".trash") {
      continue;
    }

    const childPath = path.join(fullPath, entry.name);
    if (entry.isDirectory()) {
      children.push(await buildTreeNode(childPath, vaultRoot, entry.name));
    } else if (entry.name.endsWith(".md") || entry.name.endsWith(".canvas")) {
      const childRel = path.relative(vaultRoot, childPath);
      children.push({ name: entry.name, path: childRel, type: "file" });
    }
  }

  // Sort: folders first, then files, alphabetical within each group
  children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return { name, path: relPath, type: "folder", children };
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

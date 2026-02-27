// ---------------------------------------------------------------------------
// Group Store – File-based persistence for group sessions and transcripts.
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/groups/
//     store.json                – { version: 1, groups: GroupSession[] }
//     <groupId>/transcript.json – { groupId, messages, lastSeq }
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { GroupStoreFile, GroupTranscript } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveGroupStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "groups");
}

export function resolveTranscriptPath(storePath: string, groupId: string): string {
  return path.join(storePath, groupId, "transcript.json");
}

// ---------------------------------------------------------------------------
// Empty factory functions (each returns a NEW object to avoid shared-ref bugs)
// ---------------------------------------------------------------------------

export function emptyGroupStore(): GroupStoreFile {
  return { version: 1, groups: [] };
}

export function emptyTranscript(groupId: string): GroupTranscript {
  return { groupId, messages: [], lastSeq: 0 };
}

// ---------------------------------------------------------------------------
// Generic atomic write helper
// ---------------------------------------------------------------------------

async function atomicWrite(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + ".tmp";
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Group Store – store.json
// ---------------------------------------------------------------------------

export async function readGroupStore(storePath: string): Promise<GroupStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as GroupStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.groups)) {
      return emptyGroupStore();
    }
    return parsed;
  } catch {
    return emptyGroupStore();
  }
}

export async function writeGroupStore(storePath: string, store: GroupStoreFile): Promise<void> {
  await atomicWrite(storePath, store);
}

// ---------------------------------------------------------------------------
// Transcript – <groupId>/transcript.json
// ---------------------------------------------------------------------------

export async function readTranscript(filePath: string, groupId: string): Promise<GroupTranscript> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as GroupTranscript;
    if (!Array.isArray(parsed.messages)) {
      return emptyTranscript(groupId);
    }
    return parsed;
  } catch {
    return emptyTranscript(groupId);
  }
}

export async function writeTranscript(
  filePath: string,
  transcript: GroupTranscript,
): Promise<void> {
  await atomicWrite(filePath, transcript);
}

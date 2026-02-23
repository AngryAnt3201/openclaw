// ---------------------------------------------------------------------------
// Knowledge Base Store – Stub (full implementation pending)
// ---------------------------------------------------------------------------
// This module will provide file-based operations for the knowledge base
// filesystem, mirroring the vault store interface.
// ---------------------------------------------------------------------------

import * as path from "node:path";
import type { KBNoteSummary } from "./types.js";

const DEFAULT_KB_DIR = ".miranda/knowledge-base";

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
 * List all notes in the knowledge base (recursive).
 * Stub: returns empty array until full implementation is provided.
 */
export async function listNotes(_kbPath: string, _folder?: string): Promise<KBNoteSummary[]> {
  return [];
}

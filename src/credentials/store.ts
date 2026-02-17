// ---------------------------------------------------------------------------
// Credential Store – File-based encrypted persistence
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/credentials/
//     store.enc.json   – { version: 2, credentials, secrets, masterKeyCheck }
//     audit.jsonl      – Append-only audit log
//     .keyfile         – Auto-generated master key (chmod 0600)
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, chmodSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CredentialStoreFile, CredentialAuditEntry } from "./types.js";
import { resolveCredentialAuditPath } from "./constants.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveCredentialStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "credentials", "store.enc.json");
}

// ---------------------------------------------------------------------------
// Read / write store file (atomic)
// ---------------------------------------------------------------------------

function emptyStore(): CredentialStoreFile {
  return { version: 2, credentials: [], secrets: {}, masterKeyCheck: "" };
}

export async function readCredentialStore(storePath: string): Promise<CredentialStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as CredentialStoreFile;
    if (parsed.version !== 2 || !Array.isArray(parsed.credentials)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function writeCredentialStore(
  storePath: string,
  store: CredentialStoreFile,
): Promise<void> {
  const dir = path.dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = storePath + ".tmp";
  const content = JSON.stringify(store, null, 2);
  await fs.writeFile(tmpPath, content, "utf-8");

  // Set restrictive permissions before renaming into place
  try {
    chmodSync(tmpPath, 0o600);
  } catch {
    // chmod may fail on some platforms (e.g. Windows)
  }

  await fs.rename(tmpPath, storePath);
}

// ---------------------------------------------------------------------------
// Audit log (append-only JSONL)
// ---------------------------------------------------------------------------

export async function appendAuditEntry(
  storePath: string,
  entry: CredentialAuditEntry,
): Promise<void> {
  const auditPath = resolveCredentialAuditPath(storePath);
  const dir = path.dirname(auditPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(entry) + "\n";
  await fs.appendFile(auditPath, line, "utf-8");
}

export async function readAuditLog(
  storePath: string,
  opts?: { limit?: number },
): Promise<CredentialAuditEntry[]> {
  const auditPath = resolveCredentialAuditPath(storePath);
  try {
    const raw = await fs.readFile(auditPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries: CredentialAuditEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as CredentialAuditEntry);
      } catch {
        // Skip malformed lines
      }
    }
    if (opts?.limit && opts.limit > 0) {
      return entries.slice(-opts.limit);
    }
    return entries;
  } catch {
    return [];
  }
}

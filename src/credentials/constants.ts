// ---------------------------------------------------------------------------
// Credential Manager – Constants
// ---------------------------------------------------------------------------

import * as path from "node:path";

const DEFAULT_DIR = ".openclaw";

export function resolveCredentialStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "credentials", "store.enc.json");
}

export function resolveCredentialAuditPath(storePath: string): string {
  return path.join(path.dirname(storePath), "audit.jsonl");
}

export function resolveKeyfilePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "credentials", ".keyfile");
}

/** Max usage history records to keep per credential. */
export const MAX_USAGE_HISTORY = 200;

/** Default lease TTL (2 hours). */
export const DEFAULT_LEASE_TTL_MS = 2 * 60 * 60 * 1000;

/** Lease expiry check interval (60 seconds). */
export const LEASE_EXPIRY_INTERVAL_MS = 60 * 1000;

/** Master key check sentinel value. */
export const MASTER_KEY_CHECK_SENTINEL = "openclaw-credential-manager-v2";

/** scrypt KDF defaults. */
export const KDF_DEFAULTS = {
  N: 16384,
  r: 8,
  p: 1,
  dkLen: 32,
} as const;

// ---------------------------------------------------------------------------
// Credential Store – File-based encrypted persistence
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/credentials/
//     store.enc.json   – { version: 3, credentials, secrets, masterKeyCheck, accounts, agentProfiles }
//     audit.jsonl      – Append-only audit log
//     .keyfile         – Auto-generated master key (chmod 0600)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  CredentialStoreFile,
  CredentialStoreFileV2,
  CredentialAuditEntry,
  Account,
  AccountProvider,
  AgentCredentialProfile,
} from "./types.js";
import { resolveCredentialAuditPath } from "./constants.js";
import { VALID_ACCOUNT_PROVIDERS } from "./types.js";

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
// v2 → v3 migration
// ---------------------------------------------------------------------------

export function upgradeV2toV3(v2: CredentialStoreFileV2): CredentialStoreFile {
  const now = Date.now();

  // Group credentials by provider → create one Account per provider
  const providerGroups = new Map<string, string[]>();
  for (const cred of v2.credentials) {
    const provider = cred.provider.toLowerCase();
    if (!providerGroups.has(provider)) {
      providerGroups.set(provider, []);
    }
    providerGroups.get(provider)!.push(cred.id);
  }

  const accounts: Account[] = [];
  const credAccountMap = new Map<string, string>(); // credentialId → accountId

  for (const [provider, credIds] of providerGroups) {
    const accountId = randomUUID();
    const accountProvider: AccountProvider = VALID_ACCOUNT_PROVIDERS.has(provider)
      ? (provider as AccountProvider)
      : "custom";

    accounts.push({
      id: accountId,
      name: provider.charAt(0).toUpperCase() + provider.slice(1),
      provider: accountProvider,
      credentialIds: credIds,
      tags: [],
      metadata: {},
      createdAtMs: now,
      updatedAtMs: now,
    });

    for (const credId of credIds) {
      credAccountMap.set(credId, accountId);
    }
  }

  // Set accountId back-reference on each credential
  const credentials = v2.credentials.map((cred) => ({
    ...cred,
    accountId: credAccountMap.get(cred.id),
  }));

  // Convert per-credential accessGrants → AgentCredentialProfile per unique agentId
  const agentBindings = new Map<string, { accountIds: Set<string>; directGrants: Set<string> }>();

  for (const cred of v2.credentials) {
    for (const grant of cred.accessGrants) {
      if (!agentBindings.has(grant.agentId)) {
        agentBindings.set(grant.agentId, {
          accountIds: new Set(),
          directGrants: new Set(),
        });
      }
      const entry = agentBindings.get(grant.agentId)!;
      const accountId = credAccountMap.get(cred.id);
      if (accountId) {
        entry.accountIds.add(accountId);
      }
      entry.directGrants.add(cred.id);
    }
  }

  const agentProfiles: AgentCredentialProfile[] = [];
  for (const [agentId, { accountIds, directGrants }] of agentBindings) {
    agentProfiles.push({
      agentId,
      accountBindings: [...accountIds].map((accountId) => ({
        accountId,
        grantedAtMs: now,
        grantedBy: "migration",
      })),
      directGrants: [...directGrants],
      createdAtMs: now,
      updatedAtMs: now,
    });
  }

  return {
    version: 3,
    credentials,
    secrets: v2.secrets,
    masterKeyCheck: v2.masterKeyCheck,
    accounts,
    agentProfiles,
  };
}

// ---------------------------------------------------------------------------
// Read / write store file (atomic)
// ---------------------------------------------------------------------------

function emptyStore(): CredentialStoreFile {
  return {
    version: 3,
    credentials: [],
    secrets: {},
    masterKeyCheck: "",
    accounts: [],
    agentProfiles: [],
  };
}

export async function readCredentialStore(storePath: string): Promise<CredentialStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as { version?: number };

    if (!parsed.version || !Array.isArray((parsed as CredentialStoreFile).credentials)) {
      return emptyStore();
    }

    // v3 — current format
    if (parsed.version === 3) {
      const v3 = parsed as CredentialStoreFile;
      // Ensure arrays exist (defensive)
      if (!Array.isArray(v3.accounts)) {
        v3.accounts = [];
      }
      if (!Array.isArray(v3.agentProfiles)) {
        v3.agentProfiles = [];
      }
      return v3;
    }

    // v2 — auto-upgrade
    if (parsed.version === 2) {
      const v2 = parsed as CredentialStoreFileV2;
      const upgraded = upgradeV2toV3(v2);
      // Persist the upgrade immediately
      await writeCredentialStore(storePath, upgraded);
      return upgraded;
    }

    return emptyStore();
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

// ---------------------------------------------------------------------------
// CredentialService – Core credential management service
// ---------------------------------------------------------------------------
// Follows the TaskService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { PolicyCheckContext } from "./policy-engine.js";
import type {
  Credential,
  CredentialCreateInput,
  CredentialPatch,
  CredentialFilter,
  CredentialSecret,
  CredentialCheckout,
  CredentialLease,
  PermissionRule,
  UsageRecord,
  CredentialAuditEntry,
  CredentialCategory,
  Account,
  AccountCreateInput,
  AccountPatch,
  AccountFilter,
  AccountProvider,
  AgentCredentialProfile,
  AgentAccountBinding,
  CredentialStoreFile,
} from "./types.js";
import { MAX_USAGE_HISTORY, DEFAULT_LEASE_TTL_MS } from "./constants.js";
import {
  encryptSecret,
  decryptSecret,
  createMasterKeyCheck,
  validateMasterKey,
} from "./encryption.js";
import { compileRule, evaluateRules } from "./policy-engine.js";
import { detectProvider } from "./provider-detection.js";
import { readCredentialStore, writeCredentialStore, appendAuditEntry } from "./store.js";
import { VALID_CATEGORIES, VALID_ACCOUNT_PROVIDERS } from "./types.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type CredentialServiceDeps = {
  storePath: string;
  masterKey: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
  nowMs?: () => number;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type ServiceState = {
  deps: CredentialServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: CredentialServiceDeps): ServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as TaskService)
// ---------------------------------------------------------------------------

const storeLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: ServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// CredentialService
// ---------------------------------------------------------------------------

export class CredentialService {
  private readonly state: ServiceState;
  private leaseExpiryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: CredentialServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  private async audit(
    action: string,
    credentialId: string,
    opts?: {
      credentialName?: string;
      agentId?: string;
      taskId?: string;
      outcome?: CredentialAuditEntry["outcome"];
      detail?: string;
    },
  ): Promise<void> {
    const entry: CredentialAuditEntry = {
      timestamp: this.now(),
      action,
      credentialId,
      credentialName: opts?.credentialName,
      agentId: opts?.agentId,
      taskId: opts?.taskId,
      outcome: opts?.outcome ?? "info",
      detail: opts?.detail,
    };
    await appendAuditEntry(this.state.deps.storePath, entry);
  }

  // -------------------------------------------------------------------------
  // init – ensure store exists and master key check is valid
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);

      if (!store.masterKeyCheck) {
        // New store — set master key check
        store.masterKeyCheck = createMasterKeyCheck(this.state.deps.masterKey);
        await writeCredentialStore(this.state.deps.storePath, store);
        this.state.deps.log.info("credential store initialized");
      } else {
        // Validate master key
        if (!validateMasterKey(store.masterKeyCheck, this.state.deps.masterKey)) {
          throw new Error("Invalid credential master key — cannot decrypt credential store");
        }
        this.state.deps.log.info(
          `credential store loaded (${store.credentials.length} credentials)`,
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(input: CredentialCreateInput): Promise<Credential> {
    if (!VALID_CATEGORIES.has(input.category)) {
      throw new Error(`invalid category: ${input.category}`);
    }

    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const now = this.now();
      const id = randomUUID();

      // Encrypt and store secret
      const envelope = encryptSecret(input.secret, this.state.deps.masterKey);
      store.secrets[id] = envelope;

      const credential: Credential = {
        id,
        name: input.name,
        category: input.category,
        provider: input.provider,
        description: input.description,
        tags: input.tags,
        secretRef: id,
        accessGrants: [],
        activeLeases: [],
        permissionRules: [],
        usageCount: 0,
        usageHistory: [],
        createdAtMs: now,
        updatedAtMs: now,
        enabled: true,
        accountId: input.accountId,
        secretKind: input.secret.kind,
      };

      store.credentials.push(credential);

      // If accountId specified, add credential to account
      if (input.accountId) {
        const account = store.accounts.find((a) => a.id === input.accountId);
        if (account && !account.credentialIds.includes(id)) {
          account.credentialIds.push(id);
          account.updatedAtMs = now;
        }
      }
      await writeCredentialStore(this.state.deps.storePath, store);

      await this.audit("create", id, { credentialName: input.name, outcome: "success" });
      this.emit("credential.created", credential);
      this.state.deps.log.info(`credential created: ${id} — ${input.name}`);

      return credential;
    });
  }

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  async get(credentialId: string): Promise<Credential | null> {
    const store = await readCredentialStore(this.state.deps.storePath);
    return store.credentials.find((c) => c.id === credentialId) ?? null;
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  async list(filter?: CredentialFilter): Promise<Credential[]> {
    const store = await readCredentialStore(this.state.deps.storePath);
    let creds = store.credentials;

    if (filter) {
      if (filter.category) {
        creds = creds.filter((c) => c.category === filter.category);
      }
      if (filter.provider) {
        creds = creds.filter((c) => c.provider === filter.provider);
      }
      if (filter.enabled !== undefined) {
        creds = creds.filter((c) => c.enabled === filter.enabled);
      }
      if (filter.accountId) {
        const accId = filter.accountId;
        creds = creds.filter((c) => c.accountId === accId);
      }
      if (filter.agentId) {
        const aid = filter.agentId;
        creds = creds.filter(
          (c) =>
            c.accessGrants.some((g) => g.agentId === aid) ||
            c.activeLeases.some((l) => l.agentId === aid && !l.revokedAtMs),
        );
      }
      if (filter.limit && filter.limit > 0) {
        creds = creds.slice(0, filter.limit);
      }
    }

    return creds;
  }

  // -------------------------------------------------------------------------
  // update (partial patch)
  // -------------------------------------------------------------------------

  async update(credentialId: string, patch: CredentialPatch): Promise<Credential | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === credentialId);
      if (idx === -1) {
        return null;
      }

      const cred = store.credentials[idx]!;

      if (patch.name !== undefined) {
        cred.name = patch.name;
      }
      if (patch.category !== undefined) {
        if (!VALID_CATEGORIES.has(patch.category)) {
          throw new Error(`invalid category: ${patch.category}`);
        }
        cred.category = patch.category;
      }
      if (patch.provider !== undefined) {
        cred.provider = patch.provider;
      }
      if (patch.description !== undefined) {
        cred.description = patch.description;
      }
      if (patch.tags !== undefined) {
        cred.tags = patch.tags;
      }
      if (patch.enabled !== undefined) {
        cred.enabled = patch.enabled;
      }
      if (patch.accountId !== undefined) {
        cred.accountId = patch.accountId;
      }
      cred.updatedAtMs = this.now();

      store.credentials[idx] = cred;
      await writeCredentialStore(this.state.deps.storePath, store);

      await this.audit("update", credentialId, { credentialName: cred.name, outcome: "success" });
      this.emit("credential.updated", cred);
      return cred;
    });
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(credentialId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === credentialId);
      if (idx === -1) {
        return false;
      }

      const cred = store.credentials[idx]!;
      store.credentials.splice(idx, 1);
      delete store.secrets[cred.secretRef];

      // Remove from account
      if (cred.accountId) {
        const account = store.accounts.find((a) => a.id === cred.accountId);
        if (account) {
          account.credentialIds = account.credentialIds.filter((id) => id !== credentialId);
          account.updatedAtMs = this.now();
        }
      }

      // Remove from agent profile direct grants
      for (const profile of store.agentProfiles) {
        profile.directGrants = profile.directGrants.filter((id) => id !== credentialId);
      }

      await writeCredentialStore(this.state.deps.storePath, store);

      await this.audit("delete", credentialId, { credentialName: cred.name, outcome: "success" });
      this.emit("credential.deleted", { credentialId });
      this.state.deps.log.info(`credential deleted: ${credentialId}`);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // rotateSecret
  // -------------------------------------------------------------------------

  async rotateSecret(
    credentialId: string,
    newSecret: CredentialSecret,
  ): Promise<Credential | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === credentialId);
      if (idx === -1) {
        return null;
      }

      const cred = store.credentials[idx]!;
      const envelope = encryptSecret(newSecret, this.state.deps.masterKey);
      store.secrets[cred.secretRef] = envelope;
      cred.updatedAtMs = this.now();

      store.credentials[idx] = cred;
      await writeCredentialStore(this.state.deps.storePath, store);

      await this.audit("rotate", credentialId, { credentialName: cred.name, outcome: "success" });
      this.emit("credential.updated", cred);
      this.state.deps.log.info(`credential secret rotated: ${credentialId}`);
      return cred;
    });
  }

  // -------------------------------------------------------------------------
  // enable / disable
  // -------------------------------------------------------------------------

  async enable(credentialId: string): Promise<Credential | null> {
    return this.update(credentialId, { enabled: true });
  }

  async disable(credentialId: string): Promise<Credential | null> {
    return this.update(credentialId, { enabled: false });
  }

  // -------------------------------------------------------------------------
  // Access Grants
  // -------------------------------------------------------------------------

  async grantAccess(
    credentialId: string,
    agentId: string,
    grantedBy = "user",
  ): Promise<Credential | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === credentialId);
      if (idx === -1) {
        return null;
      }

      const cred = store.credentials[idx]!;

      // Don't duplicate
      if (cred.accessGrants.some((g) => g.agentId === agentId)) {
        return cred;
      }

      cred.accessGrants.push({
        agentId,
        grantedAtMs: this.now(),
        grantedBy,
      });
      cred.updatedAtMs = this.now();

      store.credentials[idx] = cred;
      await writeCredentialStore(this.state.deps.storePath, store);

      await this.audit("grant", credentialId, {
        credentialName: cred.name,
        agentId,
        outcome: "success",
      });
      this.emit("credential.grant.added", { credentialId, agentId });
      return cred;
    });
  }

  async revokeAccess(credentialId: string, agentId: string): Promise<Credential | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === credentialId);
      if (idx === -1) {
        return null;
      }

      const cred = store.credentials[idx]!;
      cred.accessGrants = cred.accessGrants.filter((g) => g.agentId !== agentId);
      cred.updatedAtMs = this.now();

      store.credentials[idx] = cred;
      await writeCredentialStore(this.state.deps.storePath, store);

      await this.audit("revoke", credentialId, {
        credentialName: cred.name,
        agentId,
        outcome: "success",
      });
      this.emit("credential.grant.revoked", { credentialId, agentId });
      return cred;
    });
  }

  async listAccessible(agentId: string): Promise<Credential[]> {
    return this.list({ agentId });
  }

  // -------------------------------------------------------------------------
  // Leases
  // -------------------------------------------------------------------------

  async createLease(opts: {
    credentialId: string;
    taskId: string;
    agentId: string;
    ttlMs?: number;
    maxUses?: number;
  }): Promise<CredentialLease | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === opts.credentialId);
      if (idx === -1) {
        return null;
      }

      const cred = store.credentials[idx]!;
      const now = this.now();

      const lease: CredentialLease = {
        leaseId: randomUUID(),
        taskId: opts.taskId,
        agentId: opts.agentId,
        credentialId: opts.credentialId,
        grantedAtMs: now,
        expiresAtMs: now + (opts.ttlMs ?? DEFAULT_LEASE_TTL_MS),
        maxUses: opts.maxUses,
        usesRemaining: opts.maxUses,
      };

      cred.activeLeases.push(lease);
      cred.updatedAtMs = now;

      store.credentials[idx] = cred;
      await writeCredentialStore(this.state.deps.storePath, store);

      await this.audit("lease.create", opts.credentialId, {
        credentialName: cred.name,
        agentId: opts.agentId,
        taskId: opts.taskId,
        outcome: "success",
      });
      this.emit("credential.lease.created", lease);
      return lease;
    });
  }

  async revokeLease(leaseId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const now = this.now();

      for (const cred of store.credentials) {
        const leaseIdx = cred.activeLeases.findIndex((l) => l.leaseId === leaseId);
        if (leaseIdx !== -1) {
          cred.activeLeases[leaseIdx]!.revokedAtMs = now;
          cred.updatedAtMs = now;
          await writeCredentialStore(this.state.deps.storePath, store);

          this.emit("credential.lease.expired", { leaseId, credentialId: cred.id });
          return true;
        }
      }
      return false;
    });
  }

  async revokeTaskLeases(taskId: string): Promise<number> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const now = this.now();
      let revoked = 0;

      for (const cred of store.credentials) {
        for (const lease of cred.activeLeases) {
          if (lease.taskId === taskId && !lease.revokedAtMs) {
            lease.revokedAtMs = now;
            revoked++;
          }
        }
        if (revoked > 0) {
          cred.updatedAtMs = now;
        }
      }

      if (revoked > 0) {
        await writeCredentialStore(this.state.deps.storePath, store);
        this.state.deps.log.info(`revoked ${revoked} lease(s) for task ${taskId}`);
      }

      return revoked;
    });
  }

  // -------------------------------------------------------------------------
  // expireLeases – periodic cleanup
  // -------------------------------------------------------------------------

  async expireLeases(): Promise<number> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const now = this.now();
      let expired = 0;

      for (const cred of store.credentials) {
        for (const lease of cred.activeLeases) {
          if (!lease.revokedAtMs && lease.expiresAtMs <= now) {
            lease.revokedAtMs = now;
            expired++;
            this.emit("credential.lease.expired", {
              leaseId: lease.leaseId,
              credentialId: cred.id,
            });
          }
        }
      }

      if (expired > 0) {
        await writeCredentialStore(this.state.deps.storePath, store);
        this.state.deps.log.info(`expired ${expired} lease(s)`);
      }

      return expired;
    });
  }

  startLeaseExpiryTimer(intervalMs = 60_000): void {
    if (this.leaseExpiryTimer) {
      return;
    }
    this.leaseExpiryTimer = setInterval(() => {
      void this.expireLeases();
    }, intervalMs);
  }

  stopLeaseExpiryTimer(): void {
    if (this.leaseExpiryTimer) {
      clearInterval(this.leaseExpiryTimer);
      this.leaseExpiryTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // checkout – decrypt secret with policy enforcement
  // -------------------------------------------------------------------------

  async checkout(opts: {
    credentialId: string;
    agentId: string;
    taskId?: string;
    toolName?: string;
    action?: string;
  }): Promise<CredentialCheckout> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === opts.credentialId);
      if (idx === -1) {
        throw new Error(`credential not found: ${opts.credentialId}`);
      }

      const cred = store.credentials[idx]!;
      const now = this.now();

      // Check enabled
      if (!cred.enabled) {
        await this.audit("checkout", opts.credentialId, {
          credentialName: cred.name,
          agentId: opts.agentId,
          taskId: opts.taskId,
          outcome: "blocked",
          detail: "credential is disabled",
        });
        this.emit("credential.checkout.blocked", {
          credentialId: opts.credentialId,
          reason: "disabled",
        });
        throw new Error("credential is disabled");
      }

      // Check access: agent profile → legacy grant → active lease
      const hasProfileAccess = this.checkAgentProfileAccess(
        store,
        opts.agentId,
        opts.credentialId,
        cred.accountId,
      );
      const hasGrant = cred.accessGrants.some((g) => g.agentId === opts.agentId);
      const activeLease = cred.activeLeases.find(
        (l) =>
          l.agentId === opts.agentId &&
          !l.revokedAtMs &&
          l.expiresAtMs > now &&
          (opts.taskId ? l.taskId === opts.taskId : true) &&
          (l.usesRemaining === undefined || l.usesRemaining > 0),
      );

      if (!hasProfileAccess && !hasGrant && !activeLease) {
        await this.audit("checkout", opts.credentialId, {
          credentialName: cred.name,
          agentId: opts.agentId,
          taskId: opts.taskId,
          outcome: "blocked",
          detail: "no grant or active lease",
        });
        this.emit("credential.checkout.blocked", {
          credentialId: opts.credentialId,
          reason: "no_access",
        });
        throw new Error("no access grant or active lease for this agent");
      }

      // Policy evaluation
      const policyCtx: PolicyCheckContext = {
        toolName: opts.toolName,
        action: opts.action,
        agentId: opts.agentId,
        taskId: opts.taskId,
        timestampMs: now,
      };
      const policyResult = evaluateRules(cred.permissionRules, policyCtx);
      if (!policyResult.allowed) {
        await this.audit("checkout", opts.credentialId, {
          credentialName: cred.name,
          agentId: opts.agentId,
          taskId: opts.taskId,
          outcome: "blocked",
          detail: `policy: ${policyResult.reason}`,
        });
        this.emit("credential.checkout.blocked", {
          credentialId: opts.credentialId,
          reason: policyResult.reason,
          matchedRules: policyResult.matchedRules,
        });
        throw new Error(`policy blocked: ${policyResult.reason}`);
      }

      // Decrypt secret
      const envelope = store.secrets[cred.secretRef];
      if (!envelope) {
        throw new Error(`secret envelope not found for credential: ${opts.credentialId}`);
      }
      const secret = decryptSecret(envelope, this.state.deps.masterKey);

      // Decrement lease uses
      if (activeLease && activeLease.usesRemaining !== undefined) {
        activeLease.usesRemaining--;
      }

      // Record usage
      const usage: UsageRecord = {
        timestamp: now,
        agentId: opts.agentId,
        taskId: opts.taskId,
        toolName: opts.toolName,
        action: opts.action ?? "checkout",
        outcome: "success",
      };
      cred.usageHistory.push(usage);
      if (cred.usageHistory.length > MAX_USAGE_HISTORY) {
        cred.usageHistory = cred.usageHistory.slice(-MAX_USAGE_HISTORY);
      }
      cred.usageCount++;
      cred.lastUsedAtMs = now;
      cred.lastUsedByAgent = opts.agentId;
      cred.updatedAtMs = now;

      store.credentials[idx] = cred;
      await writeCredentialStore(this.state.deps.storePath, store);

      await this.audit("checkout", opts.credentialId, {
        credentialName: cred.name,
        agentId: opts.agentId,
        taskId: opts.taskId,
        outcome: "success",
      });
      this.emit("credential.checkout", {
        credentialId: opts.credentialId,
        agentId: opts.agentId,
      });

      return {
        credentialId: opts.credentialId,
        secret,
        expiresAtMs: activeLease?.expiresAtMs,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Permission Rules
  // -------------------------------------------------------------------------

  async addRule(credentialId: string, text: string): Promise<PermissionRule | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === credentialId);
      if (idx === -1) {
        return null;
      }

      const cred = store.credentials[idx]!;
      const rule: PermissionRule = {
        id: randomUUID(),
        text,
        compiledConstraints: compileRule(text),
        createdAtMs: this.now(),
        enabled: true,
      };

      cred.permissionRules.push(rule);
      cred.updatedAtMs = this.now();

      store.credentials[idx] = cred;
      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("credential.updated", cred);
      return rule;
    });
  }

  async removeRule(credentialId: string, ruleId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === credentialId);
      if (idx === -1) {
        return false;
      }

      const cred = store.credentials[idx]!;
      const before = cred.permissionRules.length;
      cred.permissionRules = cred.permissionRules.filter((r) => r.id !== ruleId);
      if (cred.permissionRules.length === before) {
        return false;
      }

      cred.updatedAtMs = this.now();
      store.credentials[idx] = cred;
      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("credential.updated", cred);
      return true;
    });
  }

  async updateRule(
    credentialId: string,
    ruleId: string,
    patch: { text?: string; enabled?: boolean },
  ): Promise<PermissionRule | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.credentials.findIndex((c) => c.id === credentialId);
      if (idx === -1) {
        return null;
      }

      const cred = store.credentials[idx]!;
      const rule = cred.permissionRules.find((r) => r.id === ruleId);
      if (!rule) {
        return null;
      }

      if (patch.text !== undefined) {
        rule.text = patch.text;
        rule.compiledConstraints = compileRule(patch.text);
      }
      if (patch.enabled !== undefined) {
        rule.enabled = patch.enabled;
      }

      cred.updatedAtMs = this.now();
      store.credentials[idx] = cred;
      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("credential.updated", cred);
      return rule;
    });
  }

  // -------------------------------------------------------------------------
  // Usage
  // -------------------------------------------------------------------------

  async getUsageHistory(credentialId: string, opts?: { limit?: number }): Promise<UsageRecord[]> {
    const store = await readCredentialStore(this.state.deps.storePath);
    const cred = store.credentials.find((c) => c.id === credentialId);
    if (!cred) {
      return [];
    }

    let history = cred.usageHistory;
    if (opts?.limit && opts.limit > 0) {
      history = history.slice(-opts.limit);
    }
    return history;
  }

  // =========================================================================
  // Account CRUD
  // =========================================================================

  async createAccount(input: AccountCreateInput): Promise<Account> {
    if (!VALID_ACCOUNT_PROVIDERS.has(input.provider)) {
      throw new Error(`invalid provider: ${input.provider}`);
    }

    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const now = this.now();
      const id = randomUUID();

      const account: Account = {
        id,
        name: input.name,
        provider: input.provider,
        icon: input.icon,
        email: input.email,
        credentialIds: [],
        tags: input.tags ?? [],
        metadata: input.metadata ?? {},
        createdAtMs: now,
        updatedAtMs: now,
      };

      store.accounts.push(account);
      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("account.created", account);
      this.state.deps.log.info(`account created: ${id} — ${input.name}`);
      return account;
    });
  }

  async getAccount(accountId: string): Promise<Account | null> {
    const store = await readCredentialStore(this.state.deps.storePath);
    return store.accounts.find((a) => a.id === accountId) ?? null;
  }

  async listAccounts(filter?: AccountFilter): Promise<Account[]> {
    const store = await readCredentialStore(this.state.deps.storePath);
    let accounts = store.accounts;
    if (filter?.provider) {
      accounts = accounts.filter((a) => a.provider === filter.provider);
    }
    if (filter?.limit && filter.limit > 0) {
      accounts = accounts.slice(0, filter.limit);
    }
    return accounts;
  }

  async updateAccount(accountId: string, patch: AccountPatch): Promise<Account | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.accounts.findIndex((a) => a.id === accountId);
      if (idx === -1) {
        return null;
      }

      const account = store.accounts[idx]!;
      if (patch.name !== undefined) {
        account.name = patch.name;
      }
      if (patch.icon !== undefined) {
        account.icon = patch.icon;
      }
      if (patch.email !== undefined) {
        account.email = patch.email;
      }
      if (patch.tags !== undefined) {
        account.tags = patch.tags;
      }
      if (patch.metadata !== undefined) {
        account.metadata = patch.metadata;
      }
      account.updatedAtMs = this.now();

      store.accounts[idx] = account;
      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("account.updated", account);
      return account;
    });
  }

  async deleteAccount(accountId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const idx = store.accounts.findIndex((a) => a.id === accountId);
      if (idx === -1) {
        return false;
      }

      const account = store.accounts[idx]!;

      // Unlink credentials (don't delete them)
      for (const cred of store.credentials) {
        if (cred.accountId === accountId) {
          cred.accountId = undefined;
          cred.updatedAtMs = this.now();
        }
      }

      // Remove account bindings from agent profiles
      for (const profile of store.agentProfiles) {
        profile.accountBindings = profile.accountBindings.filter((b) => b.accountId !== accountId);
      }

      store.accounts.splice(idx, 1);
      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("account.deleted", { accountId });
      this.state.deps.log.info(`account deleted: ${accountId} — ${account.name}`);
      return true;
    });
  }

  async addCredentialToAccount(accountId: string, credentialId: string): Promise<Account | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const account = store.accounts.find((a) => a.id === accountId);
      if (!account) {
        return null;
      }

      const cred = store.credentials.find((c) => c.id === credentialId);
      if (!cred) {
        return null;
      }

      const now = this.now();

      // Remove from old account if any
      if (cred.accountId && cred.accountId !== accountId) {
        const oldAccount = store.accounts.find((a) => a.id === cred.accountId);
        if (oldAccount) {
          oldAccount.credentialIds = oldAccount.credentialIds.filter((id) => id !== credentialId);
          oldAccount.updatedAtMs = now;
        }
      }

      // Add to new account
      if (!account.credentialIds.includes(credentialId)) {
        account.credentialIds.push(credentialId);
      }
      account.updatedAtMs = now;
      cred.accountId = accountId;
      cred.updatedAtMs = now;

      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("account.updated", account);
      return account;
    });
  }

  async removeCredentialFromAccount(
    accountId: string,
    credentialId: string,
  ): Promise<Account | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const account = store.accounts.find((a) => a.id === accountId);
      if (!account) {
        return null;
      }

      account.credentialIds = account.credentialIds.filter((id) => id !== credentialId);
      account.updatedAtMs = this.now();

      const cred = store.credentials.find((c) => c.id === credentialId);
      if (cred && cred.accountId === accountId) {
        cred.accountId = undefined;
        cred.updatedAtMs = this.now();
      }

      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("account.updated", account);
      return account;
    });
  }

  // =========================================================================
  // Agent Credential Profiles
  // =========================================================================

  async getAgentProfile(agentId: string): Promise<AgentCredentialProfile | null> {
    const store = await readCredentialStore(this.state.deps.storePath);
    return store.agentProfiles.find((p) => p.agentId === agentId) ?? null;
  }

  async listAgentProfiles(): Promise<AgentCredentialProfile[]> {
    const store = await readCredentialStore(this.state.deps.storePath);
    return store.agentProfiles;
  }

  async bindAgentToAccount(
    agentId: string,
    accountId: string,
    grantedBy = "user",
    restrictions?: AgentAccountBinding["restrictions"],
  ): Promise<AgentCredentialProfile> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const now = this.now();

      // Verify account exists
      const account = store.accounts.find((a) => a.id === accountId);
      if (!account) {
        throw new Error(`account not found: ${accountId}`);
      }

      let profile = store.agentProfiles.find((p) => p.agentId === agentId);
      if (!profile) {
        profile = {
          agentId,
          accountBindings: [],
          directGrants: [],
          createdAtMs: now,
          updatedAtMs: now,
        };
        store.agentProfiles.push(profile);
      }

      // Idempotent — don't duplicate
      if (!profile.accountBindings.some((b) => b.accountId === accountId)) {
        profile.accountBindings.push({
          accountId,
          grantedAtMs: now,
          grantedBy,
          restrictions,
        });
      }
      profile.updatedAtMs = now;

      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("agent.profile.updated", profile);
      return profile;
    });
  }

  async unbindAgentFromAccount(
    agentId: string,
    accountId: string,
  ): Promise<AgentCredentialProfile | null> {
    return locked(this.state, async () => {
      const store = await readCredentialStore(this.state.deps.storePath);
      const profile = store.agentProfiles.find((p) => p.agentId === agentId);
      if (!profile) {
        return null;
      }

      profile.accountBindings = profile.accountBindings.filter((b) => b.accountId !== accountId);
      profile.updatedAtMs = this.now();

      await writeCredentialStore(this.state.deps.storePath, store);

      this.emit("agent.profile.updated", profile);
      return profile;
    });
  }

  async resolveAgentCredentialIds(agentId: string): Promise<string[]> {
    const store = await readCredentialStore(this.state.deps.storePath);
    const profile = store.agentProfiles.find((p) => p.agentId === agentId);
    const credIds = new Set<string>();

    if (profile) {
      // Credentials from account bindings
      for (const binding of profile.accountBindings) {
        const account = store.accounts.find((a) => a.id === binding.accountId);
        if (account) {
          for (const credId of account.credentialIds) {
            // If restrictions specify credentialIds, only include those
            if (binding.restrictions?.credentialIds) {
              if (binding.restrictions.credentialIds.includes(credId)) {
                credIds.add(credId);
              }
            } else {
              credIds.add(credId);
            }
          }
        }
      }

      // Direct grants
      for (const credId of profile.directGrants) {
        credIds.add(credId);
      }
    }

    // Also include legacy accessGrants
    for (const cred of store.credentials) {
      if (cred.accessGrants.some((g) => g.agentId === agentId)) {
        credIds.add(cred.id);
      }
    }

    return [...credIds];
  }

  // =========================================================================
  // Smart Paste convenience
  // =========================================================================

  async createFromPaste(
    rawKey: string,
    overrides?: { name?: string; description?: string; accountId?: string },
  ): Promise<{ credential: Credential; detection: ReturnType<typeof detectProvider> }> {
    const detection = detectProvider(rawKey);
    if (!detection) {
      throw new Error("could not detect provider from pasted key");
    }

    const name = overrides?.name ?? detection.suggestedName;
    const secret =
      detection.secretKind === "token"
        ? { kind: "token" as const, token: rawKey.trim() }
        : { kind: "api_key" as const, key: rawKey.trim() };

    const credential = await this.create({
      name,
      category: detection.category,
      provider: detection.provider,
      description: overrides?.description,
      secret,
      accountId: overrides?.accountId,
    });

    return { credential, detection };
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private checkAgentProfileAccess(
    store: CredentialStoreFile,
    agentId: string,
    credentialId: string,
    accountId?: string,
  ): boolean {
    const profile = store.agentProfiles.find((p) => p.agentId === agentId);
    if (!profile) {
      return false;
    }

    // Check direct grants
    if (profile.directGrants.includes(credentialId)) {
      return true;
    }

    // Check account bindings
    if (accountId) {
      const binding = profile.accountBindings.find((b) => b.accountId === accountId);
      if (binding) {
        // If restrictions specify credentialIds, check against them
        if (binding.restrictions?.credentialIds) {
          return binding.restrictions.credentialIds.includes(credentialId);
        }
        return true;
      }
    }

    return false;
  }
}

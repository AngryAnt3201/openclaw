import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { CredentialStoreFile, CredentialStoreFileV2, CredentialAuditEntry } from "./types.js";
import {
  readCredentialStore,
  writeCredentialStore,
  appendAuditEntry,
  readAuditLog,
} from "./store.js";

let tmpDir: string;
let storePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cred-store-test-"));
  storePath = path.join(tmpDir, "store.enc.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Credential Store", () => {
  describe("readCredentialStore", () => {
    it("should return empty store when file does not exist", async () => {
      const store = await readCredentialStore(storePath);
      expect(store.version).toBe(3);
      expect(store.credentials).toEqual([]);
      expect(store.secrets).toEqual({});
    });

    it("should read a valid store file", async () => {
      const store: CredentialStoreFile = {
        version: 3,
        credentials: [],
        secrets: {},
        masterKeyCheck: "test",
        accounts: [],
        agentProfiles: [],
      };
      await fs.writeFile(storePath, JSON.stringify(store), "utf-8");
      const loaded = await readCredentialStore(storePath);
      expect(loaded.version).toBe(3);
      expect(loaded.masterKeyCheck).toBe("test");
    });

    it("should return empty store for invalid JSON", async () => {
      await fs.writeFile(storePath, "not-json", "utf-8");
      const store = await readCredentialStore(storePath);
      expect(store.version).toBe(3);
      expect(store.credentials).toEqual([]);
    });

    it("should return empty store for wrong version", async () => {
      const store = { version: 999, credentials: [] };
      await fs.writeFile(storePath, JSON.stringify(store), "utf-8");
      const loaded = await readCredentialStore(storePath);
      expect(loaded.version).toBe(3);
      expect(loaded.credentials).toEqual([]);
    });
  });

  describe("writeCredentialStore", () => {
    it("should write and read back a store", async () => {
      const store: CredentialStoreFile = {
        version: 3,
        credentials: [
          {
            id: "test-id",
            name: "Test",
            category: "ai_provider",
            provider: "anthropic",
            secretRef: "test-id",
            accessGrants: [],
            activeLeases: [],
            permissionRules: [],
            usageCount: 0,
            usageHistory: [],
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            enabled: true,
          },
        ],
        secrets: {},
        masterKeyCheck: "check",
        accounts: [],
        agentProfiles: [],
      };
      await writeCredentialStore(storePath, store);
      const loaded = await readCredentialStore(storePath);
      expect(loaded.credentials).toHaveLength(1);
      expect(loaded.credentials[0]!.name).toBe("Test");
    });

    it("should create parent directories", async () => {
      const deepPath = path.join(tmpDir, "a", "b", "c", "store.enc.json");
      const store: CredentialStoreFile = {
        version: 3,
        credentials: [],
        secrets: {},
        masterKeyCheck: "",
        accounts: [],
        agentProfiles: [],
      };
      await writeCredentialStore(deepPath, store);
      const loaded = await readCredentialStore(deepPath);
      expect(loaded.version).toBe(3);
    });
  });

  describe("audit log", () => {
    it("should append and read audit entries", async () => {
      const entry1: CredentialAuditEntry = {
        timestamp: 1000,
        action: "create",
        credentialId: "c1",
        outcome: "success",
      };
      const entry2: CredentialAuditEntry = {
        timestamp: 2000,
        action: "checkout",
        credentialId: "c1",
        agentId: "agent-1",
        outcome: "success",
      };
      await appendAuditEntry(storePath, entry1);
      await appendAuditEntry(storePath, entry2);

      const entries = await readAuditLog(storePath);
      expect(entries).toHaveLength(2);
      expect(entries[0]!.action).toBe("create");
      expect(entries[1]!.agentId).toBe("agent-1");
    });

    it("should support limit option", async () => {
      for (let i = 0; i < 10; i++) {
        await appendAuditEntry(storePath, {
          timestamp: i * 1000,
          action: "checkout",
          credentialId: "c1",
          outcome: "success",
        });
      }
      const entries = await readAuditLog(storePath, { limit: 3 });
      expect(entries).toHaveLength(3);
      expect(entries[0]!.timestamp).toBe(7000);
    });

    it("should return empty array when file does not exist", async () => {
      const entries = await readAuditLog(storePath);
      expect(entries).toEqual([]);
    });
  });

  describe("v2 → v3 migration", () => {
    it("should upgrade v2 store to v3 on read", async () => {
      const v2Store: CredentialStoreFileV2 = {
        version: 2,
        credentials: [
          {
            id: "cred-1",
            name: "Anthropic Key",
            category: "ai_provider",
            provider: "anthropic",
            secretRef: "cred-1",
            accessGrants: [{ agentId: "agent-1", grantedAtMs: 1000, grantedBy: "user" }],
            activeLeases: [],
            permissionRules: [],
            usageCount: 0,
            usageHistory: [],
            createdAtMs: 1000,
            updatedAtMs: 1000,
            enabled: true,
          },
        ],
        secrets: {},
        masterKeyCheck: "check",
      };
      await fs.writeFile(storePath, JSON.stringify(v2Store), "utf-8");

      const loaded = await readCredentialStore(storePath);
      expect(loaded.version).toBe(3);
      expect(loaded.accounts).toHaveLength(1);
      expect(loaded.accounts[0]!.provider).toBe("anthropic");
      expect(loaded.credentials[0]!.accountId).toBeTruthy();
      expect(loaded.agentProfiles).toHaveLength(1);
      expect(loaded.agentProfiles[0]!.agentId).toBe("agent-1");
    });

    it("should persist upgraded v3 store", async () => {
      const v2Store: CredentialStoreFileV2 = {
        version: 2,
        credentials: [
          {
            id: "cred-2",
            name: "Test Key",
            category: "service",
            provider: "github",
            secretRef: "cred-2",
            accessGrants: [],
            activeLeases: [],
            permissionRules: [],
            usageCount: 0,
            usageHistory: [],
            createdAtMs: 2000,
            updatedAtMs: 2000,
            enabled: true,
          },
        ],
        secrets: {},
        masterKeyCheck: "check2",
      };
      await fs.writeFile(storePath, JSON.stringify(v2Store), "utf-8");

      // First read triggers the migration
      const first = await readCredentialStore(storePath);
      expect(first.version).toBe(3);

      // Second read should still be v3 (persisted)
      const second = await readCredentialStore(storePath);
      expect(second.version).toBe(3);
      expect(second.credentials).toHaveLength(1);
      expect(second.credentials[0]!.name).toBe("Test Key");
    });
  });
});

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CredentialServiceDeps } from "./service.js";
import { CredentialService } from "./service.js";

let tmpDir: string;
let storePath: string;
let broadcast: ReturnType<typeof vi.fn>;
let deps: CredentialServiceDeps;
let service: CredentialService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cred-svc-test-"));
  storePath = path.join(tmpDir, "store.enc.json");
  broadcast = vi.fn();
  deps = {
    storePath,
    masterKey: "test-key-for-vitest-123",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcast,
    nowMs: () => 1700000000000,
  };
  service = new CredentialService(deps);
  await service.init();
});

afterEach(async () => {
  service.stopLeaseExpiryTimer();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("CredentialService", () => {
  describe("create", () => {
    it("should create a credential", async () => {
      const cred = await service.create({
        name: "Test API Key",
        category: "ai_provider",
        provider: "anthropic",
        secret: { kind: "api_key", key: "sk-test-123" },
      });
      expect(cred.id).toBeTruthy();
      expect(cred.name).toBe("Test API Key");
      expect(cred.category).toBe("ai_provider");
      expect(cred.provider).toBe("anthropic");
      expect(cred.enabled).toBe(true);
      expect(cred.usageCount).toBe(0);
      expect(broadcast).toHaveBeenCalledWith("credential.created", cred);
    });

    it("should reject invalid category", async () => {
      await expect(
        service.create({
          name: "Bad",
          category: "invalid" as any,
          provider: "test",
          secret: { kind: "api_key", key: "k" },
        }),
      ).rejects.toThrow("invalid category");
    });
  });

  describe("get / list", () => {
    it("should get by id", async () => {
      const created = await service.create({
        name: "Test",
        category: "service",
        provider: "github",
        secret: { kind: "token", token: "ghp-test" },
      });
      const fetched = await service.get(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("Test");
    });

    it("should return null for missing id", async () => {
      const fetched = await service.get("nonexistent");
      expect(fetched).toBeNull();
    });

    it("should list with category filter", async () => {
      await service.create({
        name: "A",
        category: "ai_provider",
        provider: "openai",
        secret: { kind: "api_key", key: "k1" },
      });
      await service.create({
        name: "B",
        category: "channel_bot",
        provider: "discord",
        secret: { kind: "token", token: "t1" },
      });
      const aiOnly = await service.list({ category: "ai_provider" });
      expect(aiOnly).toHaveLength(1);
      expect(aiOnly[0]!.name).toBe("A");
    });
  });

  describe("update / delete", () => {
    it("should update fields", async () => {
      const cred = await service.create({
        name: "Old",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      const updated = await service.update(cred.id, { name: "New", description: "Updated" });
      expect(updated!.name).toBe("New");
      expect(updated!.description).toBe("Updated");
    });

    it("should delete credential", async () => {
      const cred = await service.create({
        name: "Del",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      const deleted = await service.delete(cred.id);
      expect(deleted).toBe(true);
      const fetched = await service.get(cred.id);
      expect(fetched).toBeNull();
    });

    it("should return false for deleting nonexistent", async () => {
      expect(await service.delete("nope")).toBe(false);
    });
  });

  describe("access grants", () => {
    it("should grant and revoke access", async () => {
      const cred = await service.create({
        name: "G",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      const granted = await service.grantAccess(cred.id, "agent-1");
      expect(granted!.accessGrants).toHaveLength(1);
      expect(granted!.accessGrants[0]!.agentId).toBe("agent-1");

      const revoked = await service.revokeAccess(cred.id, "agent-1");
      expect(revoked!.accessGrants).toHaveLength(0);
    });

    it("should not duplicate grants", async () => {
      const cred = await service.create({
        name: "G",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      await service.grantAccess(cred.id, "agent-1");
      const second = await service.grantAccess(cred.id, "agent-1");
      expect(second!.accessGrants).toHaveLength(1);
    });
  });

  describe("leases", () => {
    it("should create and revoke a lease", async () => {
      const cred = await service.create({
        name: "L",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      const lease = await service.createLease({
        credentialId: cred.id,
        taskId: "task-1",
        agentId: "agent-1",
        ttlMs: 3600000,
      });
      expect(lease).not.toBeNull();
      expect(lease!.taskId).toBe("task-1");

      const revoked = await service.revokeLease(lease!.leaseId);
      expect(revoked).toBe(true);
    });

    it("should revoke all leases for a task", async () => {
      const cred = await service.create({
        name: "L",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      await service.createLease({ credentialId: cred.id, taskId: "task-x", agentId: "a1" });
      await service.createLease({ credentialId: cred.id, taskId: "task-x", agentId: "a2" });
      const count = await service.revokeTaskLeases("task-x");
      expect(count).toBe(2);
    });
  });

  describe("checkout", () => {
    it("should checkout with grant", async () => {
      const cred = await service.create({
        name: "C",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "secret-key" },
      });
      await service.grantAccess(cred.id, "agent-1");
      const result = await service.checkout({ credentialId: cred.id, agentId: "agent-1" });
      expect(result.secret).toEqual({ kind: "api_key", key: "secret-key" });
      expect(result.credentialId).toBe(cred.id);
    });

    it("should checkout with lease", async () => {
      const cred = await service.create({
        name: "C",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "secret-key" },
      });
      await service.createLease({ credentialId: cred.id, taskId: "t1", agentId: "agent-1" });
      const result = await service.checkout({
        credentialId: cred.id,
        agentId: "agent-1",
        taskId: "t1",
      });
      expect(result.secret.kind).toBe("api_key");
    });

    it("should reject checkout without access", async () => {
      const cred = await service.create({
        name: "C",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      await expect(
        service.checkout({ credentialId: cred.id, agentId: "unauthorized" }),
      ).rejects.toThrow("no access grant or active lease");
    });

    it("should reject checkout on disabled credential", async () => {
      const cred = await service.create({
        name: "C",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      await service.grantAccess(cred.id, "agent-1");
      await service.disable(cred.id);
      await expect(service.checkout({ credentialId: cred.id, agentId: "agent-1" })).rejects.toThrow(
        "disabled",
      );
    });

    it("should increment usage count on checkout", async () => {
      const cred = await service.create({
        name: "C",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      await service.grantAccess(cred.id, "agent-1");
      await service.checkout({ credentialId: cred.id, agentId: "agent-1" });
      await service.checkout({ credentialId: cred.id, agentId: "agent-1" });
      const updated = await service.get(cred.id);
      expect(updated!.usageCount).toBe(2);
    });
  });

  describe("permission rules", () => {
    it("should add and remove rules", async () => {
      const cred = await service.create({
        name: "R",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      const rule = await service.addRule(cred.id, "Read only");
      expect(rule).not.toBeNull();
      expect(rule!.text).toBe("Read only");

      const removed = await service.removeRule(cred.id, rule!.id);
      expect(removed).toBe(true);
    });

    it("should block checkout when policy denies", async () => {
      const cred = await service.create({
        name: "R",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      await service.grantAccess(cred.id, "agent-1");
      await service.addRule(cred.id, "No browser access");
      await expect(
        service.checkout({ credentialId: cred.id, agentId: "agent-1", toolName: "browser" }),
      ).rejects.toThrow("policy blocked");
    });
  });

  describe("rotateSecret", () => {
    it("should rotate and checkout new secret", async () => {
      const cred = await service.create({
        name: "Rot",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "old-key" },
      });
      await service.grantAccess(cred.id, "agent-1");

      await service.rotateSecret(cred.id, { kind: "api_key", key: "new-key" });

      const result = await service.checkout({ credentialId: cred.id, agentId: "agent-1" });
      expect((result.secret as { key: string }).key).toBe("new-key");
    });
  });

  describe("enable / disable", () => {
    it("should toggle enabled state", async () => {
      const cred = await service.create({
        name: "T",
        category: "custom",
        provider: "test",
        secret: { kind: "api_key", key: "k" },
      });
      expect(cred.enabled).toBe(true);

      const disabled = await service.disable(cred.id);
      expect(disabled!.enabled).toBe(false);

      const enabled = await service.enable(cred.id);
      expect(enabled!.enabled).toBe(true);
    });
  });

  describe("accounts", () => {
    it("should create and list accounts", async () => {
      const account = await service.createAccount({ name: "Test", provider: "github" });
      expect(account.id).toBeTruthy();
      expect(account.name).toBe("Test");
      expect(account.provider).toBe("github");

      const accounts = await service.listAccounts();
      expect(accounts).toHaveLength(1);
    });

    it("should add credential to account", async () => {
      const account = await service.createAccount({ name: "GH", provider: "github" });
      const cred = await service.create({
        name: "GH Token",
        category: "service",
        provider: "github",
        secret: { kind: "token", token: "ghp-test" },
      });

      const updated = await service.addCredentialToAccount(account.id, cred.id);
      expect(updated).not.toBeNull();
      expect(updated!.credentialIds).toContain(cred.id);

      const fetchedCred = await service.get(cred.id);
      expect(fetchedCred!.accountId).toBe(account.id);
    });

    it("should delete account and unlink credentials", async () => {
      const account = await service.createAccount({ name: "Del", provider: "github" });
      const cred = await service.create({
        name: "Token",
        category: "service",
        provider: "github",
        secret: { kind: "token", token: "ghp-del" },
      });
      await service.addCredentialToAccount(account.id, cred.id);

      const deleted = await service.deleteAccount(account.id);
      expect(deleted).toBe(true);

      const fetchedCred = await service.get(cred.id);
      expect(fetchedCred).not.toBeNull();
      expect(fetchedCred!.accountId).toBeUndefined();
    });
  });

  describe("agent profiles", () => {
    it("should bind and unbind agent to account", async () => {
      const account = await service.createAccount({ name: "Bind", provider: "anthropic" });
      await service.bindAgentToAccount("agent-1", account.id, "user");

      const profile = await service.getAgentProfile("agent-1");
      expect(profile).not.toBeNull();
      expect(profile!.accountBindings).toHaveLength(1);
      expect(profile!.accountBindings[0]!.accountId).toBe(account.id);

      await service.unbindAgentFromAccount("agent-1", account.id);
      const updated = await service.getAgentProfile("agent-1");
      expect(updated!.accountBindings).toHaveLength(0);
    });

    it("should resolve agent credential IDs", async () => {
      const account = await service.createAccount({ name: "Resolve", provider: "github" });
      const cred = await service.create({
        name: "Key",
        category: "service",
        provider: "github",
        secret: { kind: "token", token: "ghp-resolve" },
      });
      await service.addCredentialToAccount(account.id, cred.id);
      await service.bindAgentToAccount("agent-2", account.id);

      const ids = await service.resolveAgentCredentialIds("agent-2");
      expect(ids).toContain(cred.id);
    });

    it("should checkout with agent profile access", async () => {
      const account = await service.createAccount({ name: "Checkout", provider: "anthropic" });
      const cred = await service.create({
        name: "API Key",
        category: "ai_provider",
        provider: "anthropic",
        secret: { kind: "api_key", key: "sk-profile-test" },
      });
      await service.addCredentialToAccount(account.id, cred.id);
      await service.bindAgentToAccount("agent-3", account.id);

      const result = await service.checkout({ credentialId: cred.id, agentId: "agent-3" });
      expect(result.secret).toEqual({ kind: "api_key", key: "sk-profile-test" });
      expect(result.credentialId).toBe(cred.id);
    });
  });

  describe("createFromPaste", () => {
    it("should auto-detect anthropic key", async () => {
      const { credential } = await service.createFromPaste("sk-ant-api03-test123456789");
      expect(credential.provider).toBe("anthropic");
      expect(credential.category).toBe("ai_provider");
    });

    it("should use override name", async () => {
      const { credential } = await service.createFromPaste("sk-ant-api03-test123456789", {
        name: "My Key",
      });
      expect(credential.name).toBe("My Key");
    });
  });
});

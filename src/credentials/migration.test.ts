import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runCredentialMigration } from "./migration.js";
import { CredentialService } from "./service.js";

let tmpDir: string;
let storePath: string;
let service: CredentialService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cred-migrate-test-"));
  storePath = path.join(tmpDir, "store.enc.json");
  service = new CredentialService({
    storePath,
    masterKey: "migrate-test-key",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcast: vi.fn(),
    nowMs: () => 1700000000000,
  });
  await service.init();

  // Override HOME for migration path resolution
  process.env.HOME = tmpDir;
});

afterEach(async () => {
  service.stopLeaseExpiryTimer();
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.HOME;
});

describe("Credential Migration", () => {
  it("should migrate api_key profile", async () => {
    const authStore = {
      version: 2,
      profiles: {
        "anthropic:default": {
          type: "api_key",
          provider: "anthropic",
          key: "sk-ant-test-123",
          email: "test@example.com",
        },
      },
    };
    const openclawDir = path.join(tmpDir, ".openclaw");
    await fs.mkdir(openclawDir, { recursive: true });
    await fs.writeFile(path.join(openclawDir, "auth-profiles.json"), JSON.stringify(authStore));

    const result = await runCredentialMigration({
      service,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.totalMigrated).toBe(1);
    const creds = await service.list();
    expect(creds).toHaveLength(1);
    expect(creds[0]!.category).toBe("ai_provider");
    expect(creds[0]!.provider).toBe("anthropic");
    expect(creds[0]!.tags).toContain("migrated");
  });

  it("should migrate token profile", async () => {
    const authStore = {
      version: 2,
      profiles: {
        "github:default": {
          type: "token",
          provider: "github",
          token: "ghp-test-token",
        },
      },
    };
    const openclawDir = path.join(tmpDir, ".openclaw");
    await fs.mkdir(openclawDir, { recursive: true });
    await fs.writeFile(path.join(openclawDir, "auth-profiles.json"), JSON.stringify(authStore));

    const result = await runCredentialMigration({
      service,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.totalMigrated).toBe(1);
    const creds = await service.list();
    expect(creds[0]!.category).toBe("service");
    expect(creds[0]!.provider).toBe("github");
  });

  it("should migrate channel tokens from openclaw.json", async () => {
    const config = {
      channels: {
        discord: { token: "discord-bot-token", guildId: "123" },
        telegram: { botToken: "telegram-bot-token" },
      },
    };
    const openclawDir = path.join(tmpDir, ".openclaw");
    await fs.mkdir(openclawDir, { recursive: true });
    await fs.writeFile(path.join(openclawDir, "openclaw.json"), JSON.stringify(config));

    const result = await runCredentialMigration({
      service,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.totalMigrated).toBe(2);
    const creds = await service.list();
    expect(creds.every((c) => c.category === "channel_bot")).toBe(true);
  });

  it("should skip migration when store already has credentials", async () => {
    await service.create({
      name: "Existing",
      category: "custom",
      provider: "test",
      secret: { kind: "api_key", key: "k" },
    });

    const result = await runCredentialMigration({
      service,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.totalMigrated).toBe(0);
  });

  it("should handle missing auth files gracefully", async () => {
    const result = await runCredentialMigration({
      service,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.totalMigrated).toBe(0);
  });

  it("should backup auth-profiles.json after migration", async () => {
    const authStore = {
      version: 2,
      profiles: {
        "openai:default": {
          type: "api_key",
          provider: "openai",
          key: "sk-test",
        },
      },
    };
    const openclawDir = path.join(tmpDir, ".openclaw");
    await fs.mkdir(openclawDir, { recursive: true });
    const authPath = path.join(openclawDir, "auth-profiles.json");
    await fs.writeFile(authPath, JSON.stringify(authStore));

    await runCredentialMigration({
      service,
      log: { info: vi.fn(), warn: vi.fn() },
    });

    // Original should be renamed to .bak
    const bakExists = await fs
      .access(authPath + ".bak")
      .then(() => true)
      .catch(() => false);
    expect(bakExists).toBe(true);
  });
});

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CredentialServiceDeps } from "./service.js";
import { resolveChannelToken } from "./channel-token-resolver.js";
import { CredentialService } from "./service.js";

let tmpDir: string;
let storePath: string;
let broadcast: ReturnType<typeof vi.fn>;
let deps: CredentialServiceDeps;
let service: CredentialService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chan-token-test-"));
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

describe("resolveChannelToken", () => {
  it("resolves token from credential account (happy path)", async () => {
    const account = await service.createAccount({
      name: "Discord Bot",
      provider: "discord",
    });
    const cred = await service.create({
      name: "Discord Token",
      category: "channel_bot",
      provider: "discord",
      secret: { kind: "token", token: "my-discord-token" },
      accountId: account.id,
    });
    await service.bindAgentToAccount("system", account.id, "system:auto");

    const result = await resolveChannelToken({
      credentialService: service,
      credentialAccountId: account.id,
      provider: "discord",
    });

    expect(result.token).toBe("my-discord-token");
    expect(result.source).toBe("credential");
    expect(result.credentialId).toBe(cred.id);
    expect(result.accountId).toBe(account.id);
  });

  it("resolves token via metadata key (Slack multi-token)", async () => {
    const account = await service.createAccount({
      name: "Slack Workspace",
      provider: "slack",
    });
    const botCred = await service.create({
      name: "Slack Bot Token",
      category: "channel_bot",
      provider: "slack",
      secret: { kind: "token", token: "xoxb-bot-token" },
      accountId: account.id,
    });
    const appCred = await service.create({
      name: "Slack App Token",
      category: "channel_bot",
      provider: "slack",
      secret: { kind: "token", token: "xapp-app-token" },
      accountId: account.id,
    });
    await service.updateAccount(account.id, {
      metadata: {
        botTokenCredentialId: botCred.id,
        appTokenCredentialId: appCred.id,
      },
    });
    await service.bindAgentToAccount("system", account.id, "system:auto");

    const botResult = await resolveChannelToken({
      credentialService: service,
      credentialAccountId: account.id,
      provider: "slack",
      tokenMetadataKey: "botTokenCredentialId",
    });
    expect(botResult.token).toBe("xoxb-bot-token");
    expect(botResult.credentialId).toBe(botCred.id);

    const appResult = await resolveChannelToken({
      credentialService: service,
      credentialAccountId: account.id,
      provider: "slack",
      tokenMetadataKey: "appTokenCredentialId",
    });
    expect(appResult.token).toBe("xapp-app-token");
    expect(appResult.credentialId).toBe(appCred.id);
  });

  it("falls back to env when no credentialAccountId", async () => {
    process.env.__TEST_TOKEN = "env-token-value";
    try {
      const result = await resolveChannelToken({
        credentialService: service,
        provider: "discord",
        envFallbackVar: "__TEST_TOKEN",
        allowEnvFallback: true,
      });
      expect(result.token).toBe("env-token-value");
      expect(result.source).toBe("env");
      expect(result.credentialId).toBeUndefined();
    } finally {
      delete process.env.__TEST_TOKEN;
    }
  });

  it("returns none when no account and no env fallback", async () => {
    const result = await resolveChannelToken({
      credentialService: service,
      provider: "telegram",
    });
    expect(result.token).toBe("");
    expect(result.source).toBe("none");
  });

  it("returns none when account not found", async () => {
    const result = await resolveChannelToken({
      credentialService: service,
      credentialAccountId: "nonexistent-id",
      provider: "discord",
    });
    expect(result.token).toBe("");
    expect(result.source).toBe("none");
  });

  it("returns none when credential is disabled", async () => {
    const account = await service.createAccount({
      name: "Discord Bot",
      provider: "discord",
    });
    const cred = await service.create({
      name: "Disabled Token",
      category: "channel_bot",
      provider: "discord",
      secret: { kind: "token", token: "disabled-token" },
      accountId: account.id,
    });
    await service.bindAgentToAccount("system", account.id, "system:auto");
    await service.disable(cred.id);

    const result = await resolveChannelToken({
      credentialService: service,
      credentialAccountId: account.id,
      provider: "discord",
    });
    expect(result.token).toBe("");
    expect(result.source).toBe("none");
  });

  it("env fallback is disabled when allowEnvFallback is false", async () => {
    process.env.__TEST_TOKEN2 = "should-not-be-used";
    try {
      const result = await resolveChannelToken({
        credentialService: service,
        provider: "discord",
        envFallbackVar: "__TEST_TOKEN2",
        allowEnvFallback: false,
      });
      expect(result.token).toBe("");
      expect(result.source).toBe("none");
    } finally {
      delete process.env.__TEST_TOKEN2;
    }
  });

  it("falls through to first credential when metadata key not in metadata", async () => {
    const account = await service.createAccount({
      name: "Slack Workspace",
      provider: "slack",
    });
    await service.create({
      name: "Slack Bot Token",
      category: "channel_bot",
      provider: "slack",
      secret: { kind: "token", token: "xoxb-fallback" },
      accountId: account.id,
    });
    await service.bindAgentToAccount("system", account.id, "system:auto");

    const result = await resolveChannelToken({
      credentialService: service,
      credentialAccountId: account.id,
      provider: "slack",
      tokenMetadataKey: "botTokenCredentialId",
    });
    // metadata key not set, but first credential is used
    expect(result.token).toBe("xoxb-fallback");
    expect(result.source).toBe("credential");
  });

  it("works with api_key secret kind", async () => {
    const account = await service.createAccount({
      name: "Custom Bot",
      provider: "discord",
    });
    await service.create({
      name: "API Key Token",
      category: "channel_bot",
      provider: "discord",
      secret: { kind: "api_key", key: "apikey-123" },
      accountId: account.id,
    });
    await service.bindAgentToAccount("system", account.id, "system:auto");

    const result = await resolveChannelToken({
      credentialService: service,
      credentialAccountId: account.id,
      provider: "discord",
    });
    expect(result.token).toBe("apikey-123");
    expect(result.source).toBe("credential");
  });
});

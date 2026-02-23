import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { CredentialServiceDeps } from "./service.js";
import { CredentialService } from "./service.js";
import {
  SYSTEM_AGENT_ID,
  ensureSystemAgentProfile,
  bindSystemAgentToAccount,
} from "./system-agent.js";

let tmpDir: string;
let storePath: string;
let broadcast: ReturnType<typeof vi.fn>;
let deps: CredentialServiceDeps;
let service: CredentialService;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sys-agent-test-"));
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

describe("SYSTEM_AGENT_ID", () => {
  it("is 'system'", () => {
    expect(SYSTEM_AGENT_ID).toBe("system");
  });
});

describe("ensureSystemAgentProfile", () => {
  it("creates profile and binds to all channel accounts", async () => {
    const discord = await service.createAccount({ name: "Discord Bot", provider: "discord" });
    const slack = await service.createAccount({ name: "Slack Bot", provider: "slack" });
    const tg = await service.createAccount({ name: "Telegram Bot", provider: "telegram" });
    // Non-channel account — should NOT be bound
    await service.createAccount({ name: "OpenAI Key", provider: "openai" });

    await ensureSystemAgentProfile(service);

    const profile = await service.getAgentProfile(SYSTEM_AGENT_ID);
    expect(profile).toBeTruthy();
    const boundIds = profile!.accountBindings.map((b) => b.accountId).toSorted();
    expect(boundIds).toEqual([discord.id, slack.id, tg.id].toSorted());
  });

  it("is idempotent — does not duplicate bindings", async () => {
    const account = await service.createAccount({ name: "Discord Bot", provider: "discord" });

    await ensureSystemAgentProfile(service);
    await ensureSystemAgentProfile(service);

    const profile = await service.getAgentProfile(SYSTEM_AGENT_ID);
    const bindings = profile!.accountBindings.filter((b) => b.accountId === account.id);
    expect(bindings.length).toBe(1);
  });

  it("handles no channel accounts gracefully", async () => {
    await service.createAccount({ name: "GitHub Service", provider: "github" });

    await ensureSystemAgentProfile(service);

    const profile = await service.getAgentProfile(SYSTEM_AGENT_ID);
    // Profile might or might not exist — no channel accounts to bind
    if (profile) {
      expect(profile.accountBindings.length).toBe(0);
    }
  });
});

describe("bindSystemAgentToAccount", () => {
  it("binds system agent to a specific account", async () => {
    const account = await service.createAccount({ name: "Telegram Bot", provider: "telegram" });

    await bindSystemAgentToAccount(service, account.id);

    const profile = await service.getAgentProfile(SYSTEM_AGENT_ID);
    expect(profile).toBeTruthy();
    expect(profile!.accountBindings.some((b) => b.accountId === account.id)).toBe(true);
    expect(profile!.accountBindings[0]!.grantedBy).toBe("system:auto");
  });

  it("is idempotent", async () => {
    const account = await service.createAccount({ name: "Discord Bot", provider: "discord" });

    await bindSystemAgentToAccount(service, account.id);
    await bindSystemAgentToAccount(service, account.id);

    const profile = await service.getAgentProfile(SYSTEM_AGENT_ID);
    const bindings = profile!.accountBindings.filter((b) => b.accountId === account.id);
    expect(bindings.length).toBe(1);
  });

  it("allows system agent to checkout credentials on bound account", async () => {
    const account = await service.createAccount({ name: "Discord Bot", provider: "discord" });
    const cred = await service.create({
      name: "Bot Token",
      category: "channel_bot",
      provider: "discord",
      secret: { kind: "token", token: "test-token-123" },
      accountId: account.id,
    });

    await bindSystemAgentToAccount(service, account.id);

    const checkout = await service.checkout({
      credentialId: cred.id,
      agentId: SYSTEM_AGENT_ID,
    });
    expect(checkout.secret.kind).toBe("token");
    expect((checkout.secret as { kind: "token"; token: string }).token).toBe("test-token-123");
  });
});

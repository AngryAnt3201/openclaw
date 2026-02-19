import { describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext, GatewayRequestHandlerOptions } from "./types.js";
import { credentialHandlers } from "./credentials.js";

const mocks = vi.hoisted(() => ({
  detectProvider: vi.fn(),
}));

vi.mock("../../credentials/provider-detection.js", () => ({
  detectProvider: mocks.detectProvider,
}));

// ---------- helpers ----------

function makeCredentialService() {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "cred-1", name: "Test" }),
    update: vi.fn().mockResolvedValue({ id: "cred-1", name: "Updated" }),
    delete: vi.fn().mockResolvedValue(true),
    rotateSecret: vi.fn().mockResolvedValue({ id: "cred-1" }),
    enable: vi.fn().mockResolvedValue({ id: "cred-1", enabled: true }),
    disable: vi.fn().mockResolvedValue({ id: "cred-1", enabled: false }),
    grantAccess: vi.fn().mockResolvedValue({ id: "cred-1", accessGrants: [{ agentId: "a1" }] }),
    revokeAccess: vi.fn().mockResolvedValue({ id: "cred-1", accessGrants: [] }),
    createLease: vi.fn().mockResolvedValue({ id: "lease-1" }),
    revokeLease: vi.fn().mockResolvedValue(true),
    addRule: vi.fn().mockResolvedValue({ id: "rule-1", text: "test" }),
    updateRule: vi.fn().mockResolvedValue({ id: "rule-1", text: "updated" }),
    removeRule: vi.fn().mockResolvedValue(true),
    checkout: vi.fn().mockResolvedValue({ secret: { kind: "api_key", key: "sk-xxx" } }),
    createFromPaste: vi.fn().mockResolvedValue({ id: "cred-2", name: "Pasted" }),
  };
}

function makeContext(overrides?: Partial<GatewayRequestContext>): GatewayRequestContext {
  return {
    credentialService: makeCredentialService(),
    ...overrides,
  } as unknown as GatewayRequestContext;
}

function makeOpts(
  method: string,
  params: Record<string, unknown>,
  ctx?: GatewayRequestContext,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req" as const, id: "test-1", method },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: ctx ?? makeContext(),
  };
}

// ---------- tests ----------

describe("credential.list", () => {
  it("returns credentials from service", async () => {
    const mockCreds = [
      { id: "c1", name: "A" },
      { id: "c2", name: "B" },
    ];
    const ctx = makeContext();
    (ctx.credentialService!.list as ReturnType<typeof vi.fn>).mockResolvedValue(mockCreds);
    const opts = makeOpts("credential.list", {}, ctx);
    await credentialHandlers["credential.list"]!(opts);
    expect(ctx.credentialService!.list).toHaveBeenCalledWith({});
    expect(opts.respond).toHaveBeenCalledWith(true, { credentials: mockCreds }, undefined);
  });

  it("passes filter params through", async () => {
    const ctx = makeContext();
    const filter = { category: "ai_provider", enabled: true };
    const opts = makeOpts("credential.list", filter, ctx);
    await credentialHandlers["credential.list"]!(opts);
    expect(ctx.credentialService!.list).toHaveBeenCalledWith(filter);
  });

  it("responds with error when service unavailable", async () => {
    const ctx = { credentialService: undefined } as unknown as GatewayRequestContext;
    const opts = makeOpts("credential.list", {}, ctx);
    await credentialHandlers["credential.list"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "credential service not available",
      }),
    );
  });
});

describe("credential.get", () => {
  it("returns credential by ID", async () => {
    const cred = { id: "c1", name: "Test" };
    const ctx = makeContext();
    (ctx.credentialService!.get as ReturnType<typeof vi.fn>).mockResolvedValue(cred);
    const opts = makeOpts("credential.get", { credentialId: "c1" }, ctx);
    await credentialHandlers["credential.get"]!(opts);
    expect(ctx.credentialService!.get).toHaveBeenCalledWith("c1");
    expect(opts.respond).toHaveBeenCalledWith(true, cred, undefined);
  });

  it("responds error on missing id param", async () => {
    const opts = makeOpts("credential.get", {});
    await credentialHandlers["credential.get"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing credentialId" }),
    );
  });

  it("responds error when credential not found", async () => {
    const ctx = makeContext();
    (ctx.credentialService!.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const opts = makeOpts("credential.get", { credentialId: "nope" }, ctx);
    await credentialHandlers["credential.get"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "credential not found: nope" }),
    );
  });
});

describe("credential.create", () => {
  it("creates with valid params", async () => {
    const ctx = makeContext();
    const opts = makeOpts(
      "credential.create",
      {
        name: "My Key",
        category: "ai_provider",
        provider: "anthropic",
        secret: { kind: "api_key", key: "sk-test" },
      },
      ctx,
    );
    await credentialHandlers["credential.create"]!(opts);
    expect(ctx.credentialService!.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "My Key", category: "ai_provider", provider: "anthropic" }),
    );
    expect(opts.respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
  });

  it("rejects missing name", async () => {
    const opts = makeOpts("credential.create", {
      category: "ai_provider",
      provider: "anthropic",
      secret: { kind: "api_key", key: "k" },
    });
    await credentialHandlers["credential.create"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing name" }),
    );
  });

  it("rejects invalid category", async () => {
    const opts = makeOpts("credential.create", {
      name: "Test",
      category: "bogus",
      provider: "x",
      secret: { kind: "api_key", key: "k" },
    });
    await credentialHandlers["credential.create"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "invalid category: bogus" }),
    );
  });

  it("rejects missing provider", async () => {
    const opts = makeOpts("credential.create", {
      name: "Test",
      category: "ai_provider",
      secret: { kind: "api_key", key: "k" },
    });
    await credentialHandlers["credential.create"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing provider" }),
    );
  });

  it("rejects missing or invalid secret", async () => {
    const opts = makeOpts("credential.create", {
      name: "Test",
      category: "ai_provider",
      provider: "x",
    });
    await credentialHandlers["credential.create"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing or invalid secret" }),
    );
  });

  it("catches service exceptions", async () => {
    const ctx = makeContext();
    (ctx.credentialService!.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("encryption failed"),
    );
    const opts = makeOpts(
      "credential.create",
      {
        name: "Test",
        category: "ai_provider",
        provider: "x",
        secret: { kind: "api_key", key: "k" },
      },
      ctx,
    );
    await credentialHandlers["credential.create"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "encryption failed" }),
    );
  });
});

describe("credential.update", () => {
  it("patches fields", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.update", { credentialId: "c1", patch: { name: "New" } }, ctx);
    await credentialHandlers["credential.update"]!(opts);
    expect(ctx.credentialService!.update).toHaveBeenCalledWith("c1", { name: "New" });
    expect(opts.respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
  });

  it("rejects missing id", async () => {
    const opts = makeOpts("credential.update", { patch: { name: "New" } });
    await credentialHandlers["credential.update"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing credentialId" }),
    );
  });
});

describe("credential.delete", () => {
  it("deletes by id", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.delete", { credentialId: "c1" }, ctx);
    await credentialHandlers["credential.delete"]!(opts);
    expect(ctx.credentialService!.delete).toHaveBeenCalledWith("c1");
    expect(opts.respond).toHaveBeenCalledWith(true, { credentialId: "c1" }, undefined);
  });

  it("rejects missing id", async () => {
    const opts = makeOpts("credential.delete", {});
    await credentialHandlers["credential.delete"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing credentialId" }),
    );
  });
});

describe("credential.rotate", () => {
  it("rotates secret", async () => {
    const ctx = makeContext();
    const opts = makeOpts(
      "credential.rotate",
      { credentialId: "c1", secret: { kind: "api_key", key: "new-key" } },
      ctx,
    );
    await credentialHandlers["credential.rotate"]!(opts);
    expect(ctx.credentialService!.rotateSecret).toHaveBeenCalledWith("c1", {
      kind: "api_key",
      key: "new-key",
    });
  });

  it("rejects missing secret", async () => {
    const opts = makeOpts("credential.rotate", { credentialId: "c1" });
    await credentialHandlers["credential.rotate"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing secret" }),
    );
  });
});

describe("credential.enable / credential.disable", () => {
  it("enables credential", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.enable", { credentialId: "c1" }, ctx);
    await credentialHandlers["credential.enable"]!(opts);
    expect(ctx.credentialService!.enable).toHaveBeenCalledWith("c1");
    expect(opts.respond).toHaveBeenCalledWith(true, expect.anything(), undefined);
  });

  it("disables credential", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.disable", { credentialId: "c1" }, ctx);
    await credentialHandlers["credential.disable"]!(opts);
    expect(ctx.credentialService!.disable).toHaveBeenCalledWith("c1");
  });
});

describe("credential.grant / credential.revoke", () => {
  it("grants access", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.grant", { credentialId: "c1", agentId: "a1" }, ctx);
    await credentialHandlers["credential.grant"]!(opts);
    expect(ctx.credentialService!.grantAccess).toHaveBeenCalledWith("c1", "a1");
  });

  it("revokes access", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.revoke", { credentialId: "c1", agentId: "a1" }, ctx);
    await credentialHandlers["credential.revoke"]!(opts);
    expect(ctx.credentialService!.revokeAccess).toHaveBeenCalledWith("c1", "a1");
  });

  it("rejects missing agentId", async () => {
    const opts = makeOpts("credential.grant", { credentialId: "c1" });
    await credentialHandlers["credential.grant"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing agentId" }),
    );
  });
});

describe("credential.lease.create", () => {
  it("creates with required fields", async () => {
    const ctx = makeContext();
    const opts = makeOpts(
      "credential.lease.create",
      { credentialId: "c1", taskId: "t1", agentId: "a1" },
      ctx,
    );
    await credentialHandlers["credential.lease.create"]!(opts);
    expect(ctx.credentialService!.createLease).toHaveBeenCalledWith({
      credentialId: "c1",
      taskId: "t1",
      agentId: "a1",
      ttlMs: undefined,
      maxUses: undefined,
    });
  });

  it("passes optional ttlMs and maxUses", async () => {
    const ctx = makeContext();
    const opts = makeOpts(
      "credential.lease.create",
      { credentialId: "c1", taskId: "t1", agentId: "a1", ttlMs: 60000, maxUses: 5 },
      ctx,
    );
    await credentialHandlers["credential.lease.create"]!(opts);
    expect(ctx.credentialService!.createLease).toHaveBeenCalledWith(
      expect.objectContaining({ ttlMs: 60000, maxUses: 5 }),
    );
  });

  it("rejects missing required fields", async () => {
    const opts = makeOpts("credential.lease.create", { credentialId: "c1" });
    await credentialHandlers["credential.lease.create"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing credentialId, taskId, or agentId" }),
    );
  });
});

describe("credential.lease.revoke", () => {
  it("revokes by id", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.lease.revoke", { leaseId: "l1" }, ctx);
    await credentialHandlers["credential.lease.revoke"]!(opts);
    expect(ctx.credentialService!.revokeLease).toHaveBeenCalledWith("l1");
    expect(opts.respond).toHaveBeenCalledWith(true, { revoked: true }, undefined);
  });
});

describe("credential.rule.add", () => {
  it("adds rule with text", async () => {
    const ctx = makeContext();
    const opts = makeOpts(
      "credential.rule.add",
      { credentialId: "c1", text: "only for coding" },
      ctx,
    );
    await credentialHandlers["credential.rule.add"]!(opts);
    expect(ctx.credentialService!.addRule).toHaveBeenCalledWith("c1", "only for coding");
  });

  it("rejects missing text", async () => {
    const opts = makeOpts("credential.rule.add", { credentialId: "c1" });
    await credentialHandlers["credential.rule.add"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing text" }),
    );
  });
});

describe("credential.rule.update", () => {
  it("updates rule enabled flag", async () => {
    const ctx = makeContext();
    const opts = makeOpts(
      "credential.rule.update",
      { credentialId: "c1", ruleId: "r1", enabled: false },
      ctx,
    );
    await credentialHandlers["credential.rule.update"]!(opts);
    expect(ctx.credentialService!.updateRule).toHaveBeenCalledWith("c1", "r1", {
      text: undefined,
      enabled: false,
    });
  });
});

describe("credential.rule.remove", () => {
  it("removes rule by id", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.rule.remove", { credentialId: "c1", ruleId: "r1" }, ctx);
    await credentialHandlers["credential.rule.remove"]!(opts);
    expect(ctx.credentialService!.removeRule).toHaveBeenCalledWith("c1", "r1");
  });
});

describe("credential.checkout", () => {
  it("checks out with required fields", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.checkout", { credentialId: "c1", agentId: "a1" }, ctx);
    await credentialHandlers["credential.checkout"]!(opts);
    expect(ctx.credentialService!.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: "c1", agentId: "a1" }),
    );
  });

  it("passes optional toolName and action", async () => {
    const ctx = makeContext();
    const opts = makeOpts(
      "credential.checkout",
      { credentialId: "c1", agentId: "a1", toolName: "browser", action: "navigate" },
      ctx,
    );
    await credentialHandlers["credential.checkout"]!(opts);
    expect(ctx.credentialService!.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "browser", action: "navigate" }),
    );
  });

  it("catches policy violations", async () => {
    const ctx = makeContext();
    (ctx.credentialService!.checkout as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("policy denied"),
    );
    const opts = makeOpts("credential.checkout", { credentialId: "c1", agentId: "a1" }, ctx);
    await credentialHandlers["credential.checkout"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "policy denied" }),
    );
  });
});

describe("credential.detect", () => {
  it("detects provider from raw key", async () => {
    mocks.detectProvider.mockReturnValue({ provider: "anthropic", category: "ai_provider" });
    const opts = makeOpts("credential.detect", { rawKey: "sk-ant-test" });
    await credentialHandlers["credential.detect"]!(opts);
    expect(mocks.detectProvider).toHaveBeenCalledWith("sk-ant-test");
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      { detection: { provider: "anthropic", category: "ai_provider" } },
      undefined,
    );
  });

  it("rejects missing rawKey", async () => {
    const opts = makeOpts("credential.detect", {});
    await credentialHandlers["credential.detect"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing rawKey" }),
    );
  });
});

describe("credential.createFromPaste", () => {
  it("creates from raw key", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.createFromPaste", { rawKey: "sk-ant-test" }, ctx);
    await credentialHandlers["credential.createFromPaste"]!(opts);
    expect(ctx.credentialService!.createFromPaste).toHaveBeenCalledWith("sk-ant-test", {});
  });

  it("forwards name/description overrides", async () => {
    const ctx = makeContext();
    const opts = makeOpts(
      "credential.createFromPaste",
      { rawKey: "sk-ant-test", name: "My Key", description: "Production" },
      ctx,
    );
    await credentialHandlers["credential.createFromPaste"]!(opts);
    expect(ctx.credentialService!.createFromPaste).toHaveBeenCalledWith("sk-ant-test", {
      name: "My Key",
      description: "Production",
    });
  });
});

describe("credential.import", () => {
  it("responds with migration triggered message", async () => {
    const ctx = makeContext();
    const opts = makeOpts("credential.import", {}, ctx);
    await credentialHandlers["credential.import"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      true,
      { message: "migration triggered \u2014 check gateway logs" },
      undefined,
    );
  });
});

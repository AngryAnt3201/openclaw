import { describe, expect, it, vi } from "vitest";
import type { GatewayRequestContext, GatewayRequestHandlerOptions } from "./types.js";
import { taskHandlers } from "./tasks.js";

// Mock the wake helpers — they use global singletons
vi.mock("../../infra/heartbeat-wake.js", () => ({
  requestHeartbeatNow: vi.fn(),
}));
vi.mock("../../infra/system-events.js", () => ({
  enqueueSystemEvent: vi.fn(),
}));

// ---------- helpers ----------

function makeTaskService(overrides?: Record<string, unknown>) {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "task-1", title: "Test" }),
    update: vi.fn().mockResolvedValue({ id: "task-1" }),
    cancel: vi.fn().mockResolvedValue({ id: "task-1" }),
    delete: vi.fn().mockResolvedValue(true),
    approve: vi.fn().mockResolvedValue(null),
    reject: vi.fn().mockResolvedValue(null),
    respond: vi.fn().mockResolvedValue(null),
    clearFinished: vi.fn().mockResolvedValue([]),
    getEvents: vi.fn().mockResolvedValue([]),
    updateProgress: vi.fn().mockResolvedValue(null),
    addStatusUpdate: vi.fn().mockResolvedValue({ id: "su-1" }),
    getStatusUpdates: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeCredentialService(overrides?: Record<string, unknown>) {
  return {
    grantAccess: vi
      .fn()
      .mockResolvedValue({ id: "cred-1", accessGrants: [{ agentId: "agent-1" }] }),
    ...overrides,
  };
}

function makeContext(overrides?: Partial<GatewayRequestContext>): GatewayRequestContext {
  return {
    taskService: makeTaskService(),
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

// ---------- task.approve ----------

describe("task.approve", () => {
  it("responds error when taskId is missing", async () => {
    const opts = makeOpts("task.approve", {});
    await taskHandlers["task.approve"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing taskId" }),
    );
  });

  it("responds error when task not found (pre-read)", async () => {
    const ctx = makeContext();
    (ctx.taskService.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const opts = makeOpts("task.approve", { taskId: "nope" }, ctx);
    await taskHandlers["task.approve"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "task not found: nope" }),
    );
  });

  it("approves a regular task without credential logic", async () => {
    const regularTask = {
      id: "task-1",
      title: "Regular task",
      type: "instruction",
      status: "approval_required",
      sessionKey: "sess-1",
    };
    const approvedTask = { ...regularTask, status: "in_progress" };

    const ctx = makeContext();
    (ctx.taskService.get as ReturnType<typeof vi.fn>).mockResolvedValue(regularTask);
    (ctx.taskService.approve as ReturnType<typeof vi.fn>).mockResolvedValue(approvedTask);

    const opts = makeOpts("task.approve", { taskId: "task-1" }, ctx);
    await taskHandlers["task.approve"]!(opts);

    expect(ctx.taskService.approve).toHaveBeenCalledWith("task-1");
    expect(ctx.credentialService!.grantAccess).not.toHaveBeenCalled();
    expect(opts.respond).toHaveBeenCalledWith(true, approvedTask, undefined);
  });

  it("auto-grants credential access for approval_gate tasks", async () => {
    const gateTask = {
      id: "task-2",
      title: "Grant credential access: OpenAI",
      type: "approval_gate",
      status: "pending",
      sessionKey: "sess-2",
      metadata: { credentialId: "cred-abc", agentId: "coder", reason: "need API key" },
    };
    const approvedTask = { ...gateTask, status: "in_progress" };

    const ctx = makeContext();
    (ctx.taskService.get as ReturnType<typeof vi.fn>).mockResolvedValue(gateTask);
    (ctx.taskService.approve as ReturnType<typeof vi.fn>).mockResolvedValue(approvedTask);

    const opts = makeOpts("task.approve", { taskId: "task-2" }, ctx);
    await taskHandlers["task.approve"]!(opts);

    // Should call grantAccess
    expect(ctx.credentialService!.grantAccess).toHaveBeenCalledWith("cred-abc", "coder");

    // Should update task to complete
    expect(ctx.taskService.update).toHaveBeenCalledWith("task-2", {
      status: "complete",
      result: {
        success: true,
        summary: "Credential access granted to coder for cred-abc.",
      },
    });

    expect(opts.respond).toHaveBeenCalledWith(true, approvedTask, undefined);
  });

  it("skips credential logic if credentialService is unavailable", async () => {
    const gateTask = {
      id: "task-3",
      title: "Grant credential",
      type: "approval_gate",
      status: "pending",
      sessionKey: "sess-3",
      metadata: { credentialId: "cred-abc", agentId: "coder" },
    };
    const approvedTask = { ...gateTask, status: "in_progress" };

    const ctx = makeContext({ credentialService: undefined });
    (ctx.taskService.get as ReturnType<typeof vi.fn>).mockResolvedValue(gateTask);
    (ctx.taskService.approve as ReturnType<typeof vi.fn>).mockResolvedValue(approvedTask);

    const opts = makeOpts("task.approve", { taskId: "task-3" }, ctx);
    await taskHandlers["task.approve"]!(opts);

    // Should NOT call update to complete (no credential service)
    expect(ctx.taskService.update).not.toHaveBeenCalled();
    expect(opts.respond).toHaveBeenCalledWith(true, approvedTask, undefined);
  });

  it("skips credential logic when metadata lacks credentialId", async () => {
    const gateTask = {
      id: "task-4",
      title: "Some approval gate",
      type: "approval_gate",
      status: "pending",
      sessionKey: "sess-4",
      metadata: { reason: "generic" },
    };
    const approvedTask = { ...gateTask, status: "in_progress" };

    const ctx = makeContext();
    (ctx.taskService.get as ReturnType<typeof vi.fn>).mockResolvedValue(gateTask);
    (ctx.taskService.approve as ReturnType<typeof vi.fn>).mockResolvedValue(approvedTask);

    const opts = makeOpts("task.approve", { taskId: "task-4" }, ctx);
    await taskHandlers["task.approve"]!(opts);

    expect(ctx.credentialService!.grantAccess).not.toHaveBeenCalled();
    expect(ctx.taskService.update).not.toHaveBeenCalled();
  });
});

// ---------- task.reject ----------

describe("task.reject", () => {
  it("responds error when taskId is missing", async () => {
    const opts = makeOpts("task.reject", {});
    await taskHandlers["task.reject"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "missing taskId" }),
    );
  });

  it("responds error when task not found (pre-read)", async () => {
    const ctx = makeContext();
    (ctx.taskService.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const opts = makeOpts("task.reject", { taskId: "nope" }, ctx);
    await taskHandlers["task.reject"]!(opts);
    expect(opts.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "task not found: nope" }),
    );
  });

  it("rejects a regular task without credential logic", async () => {
    const regularTask = {
      id: "task-1",
      title: "Regular",
      type: "instruction",
      status: "approval_required",
      sessionKey: "sess-1",
    };
    const rejectedTask = { ...regularTask, status: "in_progress" };

    const ctx = makeContext();
    (ctx.taskService.get as ReturnType<typeof vi.fn>).mockResolvedValue(regularTask);
    (ctx.taskService.reject as ReturnType<typeof vi.fn>).mockResolvedValue(rejectedTask);

    const opts = makeOpts("task.reject", { taskId: "task-1" }, ctx);
    await taskHandlers["task.reject"]!(opts);

    expect(ctx.taskService.reject).toHaveBeenCalledWith("task-1", undefined);
    expect(ctx.taskService.update).not.toHaveBeenCalled();
    expect(opts.respond).toHaveBeenCalledWith(true, rejectedTask, undefined);
  });

  it("auto-fails credential approval_gate on reject", async () => {
    const gateTask = {
      id: "task-5",
      title: "Grant credential access: Stripe",
      type: "approval_gate",
      status: "pending",
      sessionKey: "sess-5",
      metadata: {
        credentialId: "cred-stripe",
        agentId: "architect",
        reason: "payment integration",
      },
    };
    const rejectedTask = { ...gateTask, status: "in_progress" };

    const ctx = makeContext();
    (ctx.taskService.get as ReturnType<typeof vi.fn>).mockResolvedValue(gateTask);
    (ctx.taskService.reject as ReturnType<typeof vi.fn>).mockResolvedValue(rejectedTask);

    const opts = makeOpts("task.reject", { taskId: "task-5", reason: "not now" }, ctx);
    await taskHandlers["task.reject"]!(opts);

    // Should NOT grant access
    expect(ctx.credentialService!.grantAccess).not.toHaveBeenCalled();

    // Should update task to failed
    expect(ctx.taskService.update).toHaveBeenCalledWith("task-5", {
      status: "failed",
      result: {
        success: false,
        error: "Credential access denied: not now",
      },
    });

    expect(opts.respond).toHaveBeenCalledWith(true, rejectedTask, undefined);
  });

  it("auto-fails credential gate with default message when no reason", async () => {
    const gateTask = {
      id: "task-6",
      title: "Grant credential",
      type: "approval_gate",
      status: "pending",
      sessionKey: "sess-6",
      metadata: { credentialId: "cred-x", agentId: "coder" },
    };
    const rejectedTask = { ...gateTask, status: "in_progress" };

    const ctx = makeContext();
    (ctx.taskService.get as ReturnType<typeof vi.fn>).mockResolvedValue(gateTask);
    (ctx.taskService.reject as ReturnType<typeof vi.fn>).mockResolvedValue(rejectedTask);

    const opts = makeOpts("task.reject", { taskId: "task-6" }, ctx);
    await taskHandlers["task.reject"]!(opts);

    expect(ctx.taskService.update).toHaveBeenCalledWith("task-6", {
      status: "failed",
      result: {
        success: false,
        error: "Credential access denied.",
      },
    });
  });
});

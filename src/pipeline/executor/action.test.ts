// ---------------------------------------------------------------------------
// Pipeline Executor – Action Node Unit Tests (Notify)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { PipelineNode, NodeConfig } from "../types.js";
import type { ExecutorContext } from "./types.js";
import { executeNotifyNode } from "./action.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeNotifyNode(config: Record<string, unknown> = {}): PipelineNode {
  return {
    id: "notify-1",
    type: "notify",
    label: "Test Notify",
    config: {
      channels: ["slack"],
      message: "Hello {{input}}",
      priority: "medium",
      ...config,
    } as NodeConfig,
    position: { x: 0, y: 0 },
    state: { status: "idle" as const, retryCount: 0 },
  };
}

function makeContext(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    callGatewayRpc: vi.fn().mockResolvedValue({ id: "notif-1" }),
    log: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

// ===========================================================================
// Notify Node
// ===========================================================================

describe("executeNotifyNode", () => {
  it("auto-resolves channels when empty", async () => {
    const ctx = makeContext();
    const result = await executeNotifyNode(makeNotifyNode({ channels: [] }), "hello", ctx);
    expect(result.status).toBe("success");
  });

  it("auto-generates message when not provided", async () => {
    const ctx = makeContext();
    const result = await executeNotifyNode(makeNotifyNode({ message: undefined }), "hello", ctx);
    expect(result.status).toBe("success");
  });

  it("returns failure when callGatewayRpc is not available", async () => {
    const result = await executeNotifyNode(
      makeNotifyNode(),
      undefined,
      makeContext({ callGatewayRpc: undefined }),
    );
    expect(result.status).toBe("failure");
    expect(result.error).toContain("callGatewayRpc");
  });

  it("calls notification.create RPC with correct params", async () => {
    const ctx = makeContext();
    await executeNotifyNode(makeNotifyNode(), "world", ctx);

    expect(ctx.callGatewayRpc).toHaveBeenCalledWith("notification.create", {
      type: "custom",
      title: "Pipeline: Test Notify",
      body: "Hello world",
      channels: ["slack"],
      priority: "medium",
      source: "pipeline",
    });
  });

  it("interpolates {{input}} with string input", async () => {
    const ctx = makeContext();
    await executeNotifyNode(makeNotifyNode({ message: "Status: {{input}}" }), "all good", ctx);

    const rpcArgs = (ctx.callGatewayRpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(rpcArgs.body).toBe("Status: all good");
  });

  it("interpolates {{input}} with object input as JSON", async () => {
    const ctx = makeContext();
    await executeNotifyNode(makeNotifyNode({ message: "Data: {{input}}" }), { score: 42 }, ctx);

    const rpcArgs = (ctx.callGatewayRpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(rpcArgs.body).toContain("42");
  });

  it("interpolates {{input.path}} with nested object", async () => {
    const ctx = makeContext();
    await executeNotifyNode(
      makeNotifyNode({ message: "Score: {{input.score}}" }),
      { score: 95 },
      ctx,
    );

    const rpcArgs = (ctx.callGatewayRpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(rpcArgs.body).toBe("Score: 95");
  });

  it("returns success on successful RPC call", async () => {
    const result = await executeNotifyNode(makeNotifyNode(), "hello", makeContext());
    expect(result.status).toBe("success");
    expect(result.durationMs).toBeDefined();
  });

  it("returns failure when RPC throws", async () => {
    const ctx = makeContext({
      callGatewayRpc: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const result = await executeNotifyNode(makeNotifyNode(), "hello", ctx);
    expect(result.status).toBe("failure");
    expect(result.error).toBe("network error");
  });

  it("uses default priority 'medium' when not specified", async () => {
    const ctx = makeContext();
    await executeNotifyNode(makeNotifyNode({ priority: undefined }), "hi", ctx);

    const rpcArgs = (ctx.callGatewayRpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(rpcArgs.priority).toBe("medium");
  });
});

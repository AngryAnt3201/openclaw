// ---------------------------------------------------------------------------
// Pipeline Executor – Action Node Unit Tests (Notify + Output)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { PipelineNode, NodeConfig } from "../types.js";
import type { ExecutorContext } from "./types.js";
import { executeNotifyNode, executeOutputNode } from "./action.js";

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

function makeOutputNode(config: Record<string, unknown> = {}): PipelineNode {
  return {
    id: "output-1",
    type: "output",
    label: "Test Output",
    config: {
      format: "json",
      destination: "log",
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

// ===========================================================================
// Output Node
// ===========================================================================

describe("executeOutputNode", () => {
  it("json format — object input passes through", async () => {
    const input = { data: [1, 2, 3] };
    const result = await executeOutputNode(
      makeOutputNode({ format: "json" }),
      input,
      makeContext(),
    );

    expect(result.status).toBe("success");
    expect((result.output as Record<string, unknown>).data).toEqual(input);
    expect((result.output as Record<string, unknown>).format).toBe("json");
  });

  it("json format — string input is parsed as JSON", async () => {
    const result = await executeOutputNode(
      makeOutputNode({ format: "json" }),
      '{"key":"value"}',
      makeContext(),
    );

    expect(result.status).toBe("success");
    expect((result.output as Record<string, unknown>).data).toEqual({ key: "value" });
  });

  it("text format — object input is stringified", async () => {
    const result = await executeOutputNode(
      makeOutputNode({ format: "text" }),
      { key: "value" },
      makeContext(),
    );

    expect(result.status).toBe("success");
    const data = (result.output as Record<string, unknown>).data as string;
    expect(data).toContain("key");
    expect(data).toContain("value");
  });

  it("text format — string input passes through", async () => {
    const result = await executeOutputNode(
      makeOutputNode({ format: "text" }),
      "raw text",
      makeContext(),
    );

    expect(result.status).toBe("success");
    expect((result.output as Record<string, unknown>).data).toBe("raw text");
  });

  it("markdown format — string input passes through", async () => {
    const result = await executeOutputNode(
      makeOutputNode({ format: "markdown" }),
      "# Title\n\nContent",
      makeContext(),
    );

    expect(result.status).toBe("success");
    expect((result.output as Record<string, unknown>).data).toBe("# Title\n\nContent");
  });

  it("markdown format — object input is wrapped in code block", async () => {
    const result = await executeOutputNode(
      makeOutputNode({ format: "markdown" }),
      { key: "value" },
      makeContext(),
    );

    expect(result.status).toBe("success");
    const data = (result.output as Record<string, unknown>).data as string;
    expect(data).toContain("```json");
    expect(data).toContain("key");
  });

  it("output includes destination and path", async () => {
    const result = await executeOutputNode(
      makeOutputNode({ format: "text", destination: "file", path: "/tmp/out.json" }),
      "some data",
      makeContext(),
    );

    const output = result.output as Record<string, unknown>;
    expect(output.destination).toBe("file");
    expect(output.path).toBe("/tmp/out.json");
  });

  it("defaults destination to 'log' when not specified", async () => {
    const result = await executeOutputNode(
      makeOutputNode({ format: "text", destination: undefined }),
      "some data",
      makeContext(),
    );

    expect((result.output as Record<string, unknown>).destination).toBe("log");
  });

  it("invalid JSON string in json format falls through to raw value", async () => {
    const result = await executeOutputNode(
      makeOutputNode({ format: "json" }),
      "not json",
      makeContext(),
    );

    // JSON.parse("not json") throws, which is caught.
    expect(result.status).toBe("failure");
  });
});

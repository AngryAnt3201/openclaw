// ---------------------------------------------------------------------------
// Pipeline Executor – Condition Node (LLM Router) Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { PipelineNode, NodeConfig } from "../types.js";
import type { ExecutorContext } from "./types.js";
import { executeConditionNode } from "./condition.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeNode(question: string, options: string[]): PipelineNode {
  return {
    id: "cond-1",
    type: "condition",
    label: "Test Router",
    config: { question, options } as NodeConfig,
    position: { x: 0, y: 0 },
    state: { status: "idle" as const, retryCount: 0 },
  };
}

function makeContext(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    callGatewayRpc: vi.fn().mockResolvedValue({ option: "Archive" }),
    log: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeConditionNode", () => {
  // --- Validation ---

  it("returns failure when question is empty", async () => {
    const result = await executeConditionNode(makeNode("", ["A", "B"]), undefined, makeContext());
    expect(result.status).toBe("failure");
    expect(result.error).toContain("question");
  });

  it("returns failure when options has fewer than 2 items", async () => {
    const result = await executeConditionNode(
      makeNode("Which?", ["Only"]),
      undefined,
      makeContext(),
    );
    expect(result.status).toBe("failure");
    expect(result.error).toContain("2 options");
  });

  it("returns failure when options is empty", async () => {
    const result = await executeConditionNode(makeNode("Which?", []), undefined, makeContext());
    expect(result.status).toBe("failure");
    expect(result.error).toContain("2 options");
  });

  it("returns failure when callGatewayRpc is not available", async () => {
    const result = await executeConditionNode(
      makeNode("Which?", ["A", "B"]),
      undefined,
      makeContext({ callGatewayRpc: undefined }),
    );
    expect(result.status).toBe("failure");
    expect(result.error).toContain("callGatewayRpc");
  });

  // --- Successful classification ---

  it("calls pipeline.classify RPC with correct params", async () => {
    const ctx = makeContext();
    await executeConditionNode(makeNode("Is this spam?", ["Yes", "No"]), "hello world", ctx);

    expect(ctx.callGatewayRpc).toHaveBeenCalledWith("pipeline.classify", {
      question: "Is this spam?",
      options: ["Yes", "No"],
      input: "hello world",
    });
  });

  it("returns chosen option as outputHandle", async () => {
    const ctx = makeContext({
      callGatewayRpc: vi.fn().mockResolvedValue({ option: "Needs Action" }),
    });
    const result = await executeConditionNode(
      makeNode("What to do?", ["Needs Action", "Archive", "Spam"]),
      "urgent email",
      ctx,
    );

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("Needs Action");
  });

  it("output includes question and chosen option", async () => {
    const ctx = makeContext({
      callGatewayRpc: vi.fn().mockResolvedValue({ option: "Archive" }),
    });
    const result = await executeConditionNode(
      makeNode("Route this?", ["Archive", "Delete"]),
      "some input",
      ctx,
    );

    expect(result.output).toEqual({ question: "Route this?", chosen: "Archive" });
  });

  it("returns failure when LLM returns unknown option", async () => {
    const ctx = makeContext({
      callGatewayRpc: vi.fn().mockResolvedValue({ option: "Unknown" }),
    });
    const result = await executeConditionNode(makeNode("Route?", ["A", "B"]), "input", ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toContain("Unknown");
    expect(result.error).toContain("A, B");
  });

  // --- Input summarization ---

  it("summarizes object input as JSON for the RPC call", async () => {
    const ctx = makeContext();
    await executeConditionNode(
      makeNode("Classify?", ["Good", "Bad"]),
      { score: 42, label: "test" },
      ctx,
    );

    const rpcArgs = (ctx.callGatewayRpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(rpcArgs.input).toContain("42");
    expect(rpcArgs.input).toContain("test");
  });

  it("handles null input gracefully", async () => {
    const ctx = makeContext();
    await executeConditionNode(makeNode("Route?", ["A", "B"]), null, ctx);

    const rpcArgs = (ctx.callGatewayRpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(rpcArgs.input).toBe("(no input)");
  });

  it("handles undefined input gracefully", async () => {
    const ctx = makeContext();
    await executeConditionNode(makeNode("Route?", ["A", "B"]), undefined, ctx);

    const rpcArgs = (ctx.callGatewayRpc as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(rpcArgs.input).toBe("(no input)");
  });

  // --- Error handling ---

  it("returns failure when RPC throws", async () => {
    const ctx = makeContext({
      callGatewayRpc: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const result = await executeConditionNode(makeNode("Route?", ["A", "B"]), "input", ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toBe("network error");
  });

  // --- Duration tracking ---

  it("includes durationMs in result", async () => {
    const result = await executeConditionNode(
      makeNode("Route?", ["A", "B"]),
      "input",
      makeContext({ callGatewayRpc: vi.fn().mockResolvedValue({ option: "A" }) }),
    );

    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe("number");
  });

  // --- N-way routing ---

  it("supports 3+ options for N-way routing", async () => {
    const options = ["Critical", "Normal", "Low", "Spam"];
    const ctx = makeContext({
      callGatewayRpc: vi.fn().mockResolvedValue({ option: "Critical" }),
    });
    const result = await executeConditionNode(
      makeNode("Classify priority?", options),
      "urgent request",
      ctx,
    );

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("Critical");
  });
});

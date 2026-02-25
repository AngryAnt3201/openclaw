// ---------------------------------------------------------------------------
// Pipeline Executor – Condition Node Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { PipelineNode, NodeConfig } from "../types.js";
import type { ExecutorContext } from "./types.js";
import { executeConditionNode } from "./condition.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeNode(expression: string): PipelineNode {
  return {
    id: "cond-1",
    type: "condition",
    label: "Test Condition",
    config: { expression } as NodeConfig,
    position: { x: 0, y: 0 },
    state: { status: "idle" as const, retryCount: 0 },
  };
}

const ctx: ExecutorContext = { log: { info: vi.fn(), error: vi.fn() } };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeConditionNode", () => {
  // --- Validation ---

  it("returns failure when expression is empty", async () => {
    const result = await executeConditionNode(makeNode(""), undefined, ctx);
    expect(result.status).toBe("failure");
    expect(result.error).toContain("expression");
  });

  // --- Boolean literals ---

  it("expression 'true' → outputHandle 'true'", async () => {
    const result = await executeConditionNode(makeNode("true"), undefined, ctx);
    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("true");
  });

  it("expression 'false' → outputHandle 'false'", async () => {
    const result = await executeConditionNode(makeNode("false"), undefined, ctx);
    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("false");
  });

  // --- Input-based expressions ---

  it("'input' with truthy input → true", async () => {
    const result = await executeConditionNode(makeNode("input"), { data: 1 }, ctx);
    expect(result.outputHandle).toBe("true");
  });

  it("'input' with null input → false", async () => {
    const result = await executeConditionNode(makeNode("input"), null, ctx);
    expect(result.outputHandle).toBe("false");
  });

  it("'input' with 0 input → false", async () => {
    const result = await executeConditionNode(makeNode("input"), 0, ctx);
    expect(result.outputHandle).toBe("false");
  });

  // --- Dot-path access ---

  it("'input.status' resolves nested property", async () => {
    const result = await executeConditionNode(makeNode("input.status"), { status: "active" }, ctx);
    expect(result.outputHandle).toBe("true");
  });

  it("'input.deep.nested' resolves deep path", async () => {
    const result = await executeConditionNode(
      makeNode("input.deep.nested"),
      { deep: { nested: true } },
      ctx,
    );
    expect(result.outputHandle).toBe("true");
  });

  it("missing path returns undefined → false", async () => {
    const result = await executeConditionNode(makeNode("input.missing.path"), { data: 1 }, ctx);
    expect(result.outputHandle).toBe("false");
  });

  // --- Equality comparisons ---

  it("'input.status === \"active\"' with matching value → true", async () => {
    const result = await executeConditionNode(
      makeNode('input.status === "active"'),
      { status: "active" },
      ctx,
    );
    expect(result.outputHandle).toBe("true");
  });

  it("'input.status === \"active\"' with non-matching value → false", async () => {
    const result = await executeConditionNode(
      makeNode('input.status === "active"'),
      { status: "inactive" },
      ctx,
    );
    expect(result.outputHandle).toBe("false");
  });

  it("'input.count !== 0' with count=5 → true", async () => {
    const result = await executeConditionNode(makeNode("input.count !== 0"), { count: 5 }, ctx);
    expect(result.outputHandle).toBe("true");
  });

  it("'input.count !== 0' with count=0 → false", async () => {
    const result = await executeConditionNode(makeNode("input.count !== 0"), { count: 0 }, ctx);
    expect(result.outputHandle).toBe("false");
  });

  // --- Numeric comparisons ---

  it("'input.score > 50' with score=80 → true", async () => {
    const result = await executeConditionNode(makeNode("input.score > 50"), { score: 80 }, ctx);
    expect(result.outputHandle).toBe("true");
  });

  it("'input.score > 50' with score=30 → false", async () => {
    const result = await executeConditionNode(makeNode("input.score > 50"), { score: 30 }, ctx);
    expect(result.outputHandle).toBe("false");
  });

  it("'input.score < 100' with score=80 → true", async () => {
    const result = await executeConditionNode(makeNode("input.score < 100"), { score: 80 }, ctx);
    expect(result.outputHandle).toBe("true");
  });

  it("'input.score >= 80' with score=80 → true (boundary)", async () => {
    const result = await executeConditionNode(makeNode("input.score >= 80"), { score: 80 }, ctx);
    expect(result.outputHandle).toBe("true");
  });

  it("'input.score <= 80' with score=80 → true (boundary)", async () => {
    const result = await executeConditionNode(makeNode("input.score <= 80"), { score: 80 }, ctx);
    expect(result.outputHandle).toBe("true");
  });

  // --- Boolean comparisons ---

  it("'input.ready === true' with ready=true → true", async () => {
    const result = await executeConditionNode(
      makeNode("input.ready === true"),
      { ready: true },
      ctx,
    );
    expect(result.outputHandle).toBe("true");
  });

  it("'input.ready === false' with ready=false → true", async () => {
    const result = await executeConditionNode(
      makeNode("input.ready === false"),
      { ready: false },
      ctx,
    );
    expect(result.outputHandle).toBe("true");
  });

  // --- Output structure ---

  it("output includes expression and boolean result", async () => {
    const result = await executeConditionNode(makeNode("true"), undefined, ctx);
    expect(result.output).toEqual({ expression: "true", result: true });
  });

  it("output includes durationMs", async () => {
    const result = await executeConditionNode(makeNode("true"), undefined, ctx);
    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe("number");
  });
});

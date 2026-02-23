import { describe, it, expect, vi } from "vitest";
import type { PipelineNode, NodeConfig } from "../types.js";
import type { ExecutorContext } from "./types.js";
import { executeLoopNode } from "./loop.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_STATE = { status: "idle" as const, retryCount: 0 };

function makeNode(id: string, config: Partial<NodeConfig> = {}): PipelineNode {
  return {
    id,
    type: "loop",
    label: id,
    config: { kind: "loop", maxIterations: 10, condition: "", ...config } as NodeConfig,
    position: { x: 0, y: 0 },
    state: { ...DEFAULT_STATE },
  };
}

function makeContext(): ExecutorContext {
  return { log: { info: vi.fn(), error: vi.fn() } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeLoopNode", () => {
  // -------------------------------------------------------------------------
  // 1. Basic loop with maxIterations=3, no condition — runs 3 iterations
  // -------------------------------------------------------------------------
  it("runs exactly maxIterations when no condition is set", async () => {
    const node = makeNode("loop-1", { maxIterations: 3, condition: "" });
    const result = await executeLoopNode(node, "start", makeContext());

    expect(result.status).toBe("success");
    expect(result.output).toBeDefined();

    const out = result.output as { iterations: number; lastOutput: unknown; outputs: unknown[] };
    expect(out.iterations).toBe(3);
    expect(out.outputs).toHaveLength(3);
  });

  it("runs default maxIterations (10) when not specified", async () => {
    const node = makeNode("loop-default");
    // The helper sets maxIterations: 10 by default — verify that behavior.
    const result = await executeLoopNode(node, null, makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number; outputs: unknown[] };
    expect(out.iterations).toBe(10);
    expect(out.outputs).toHaveLength(10);
  });

  // -------------------------------------------------------------------------
  // 2. maxIterations <= 0 returns failure
  // -------------------------------------------------------------------------
  it("returns failure when maxIterations is 0", async () => {
    const node = makeNode("loop-zero", { maxIterations: 0 });
    const result = await executeLoopNode(node, "x", makeContext());

    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/maxIterations must be > 0/);
    expect(result.durationMs).toBeTypeOf("number");
  });

  it("returns failure when maxIterations is negative", async () => {
    const node = makeNode("loop-neg", { maxIterations: -5 });
    const result = await executeLoopNode(node, "x", makeContext());

    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/maxIterations must be > 0/);
  });

  // -------------------------------------------------------------------------
  // 3. Loop with condition "false" — breaks after first iteration
  //    (condition is checked from iteration 1, i.e. after the first pass)
  // -------------------------------------------------------------------------
  it('breaks after first iteration when condition is "false"', async () => {
    const node = makeNode("loop-false", { maxIterations: 10, condition: "false" });
    const result = await executeLoopNode(node, "init", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number; outputs: unknown[] };
    // iteration 0: condition skipped → runs. iteration 1: condition "false" → break.
    expect(out.iterations).toBe(1);
    expect(out.outputs).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 4. Loop with condition "true" — runs all maxIterations
  // -------------------------------------------------------------------------
  it('runs all maxIterations when condition is "true"', async () => {
    const node = makeNode("loop-true", { maxIterations: 5, condition: "true" });
    const result = await executeLoopNode(node, "init", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number; outputs: unknown[] };
    expect(out.iterations).toBe(5);
    expect(out.outputs).toHaveLength(5);
  });

  // -------------------------------------------------------------------------
  // 5. Loop with numeric condition "iteration < 3" — runs 3 iterations
  // -------------------------------------------------------------------------
  it('stops at iteration 3 when condition is "iteration < 3"', async () => {
    const node = makeNode("loop-iter", { maxIterations: 10, condition: "iteration < 3" });
    const result = await executeLoopNode(node, "init", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number; outputs: unknown[] };
    // iteration 0: condition skipped → runs
    // iteration 1: 1 < 3 → true → runs
    // iteration 2: 2 < 3 → true → runs
    // iteration 3: 3 < 3 → false → break
    expect(out.iterations).toBe(3);
    expect(out.outputs).toHaveLength(3);
  });

  it('respects "iteration <= 2" condition', async () => {
    const node = makeNode("loop-lte", { maxIterations: 10, condition: "iteration <= 2" });
    const result = await executeLoopNode(node, "init", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number; outputs: unknown[] };
    // iteration 0: skipped → runs
    // iteration 1: 1 <= 2 → true → runs
    // iteration 2: 2 <= 2 → true → runs
    // iteration 3: 3 <= 2 → false → break
    expect(out.iterations).toBe(3);
  });

  it('respects "iteration > 0" condition (always true, runs all)', async () => {
    const node = makeNode("loop-gt", { maxIterations: 4, condition: "iteration > 0" });
    const result = await executeLoopNode(node, "init", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number };
    // Condition checked from iteration 1 onward; iteration > 0 is always true there.
    expect(out.iterations).toBe(4);
  });

  // -------------------------------------------------------------------------
  // 6. Loop with input-based condition "input.done === true" — breaks when
  //    the accumulated input signals done.
  // -------------------------------------------------------------------------
  it("breaks when input-based equality condition matches", async () => {
    // The loop wraps currentInput as { iteration, previousOutput } each pass.
    // After iteration 1, currentInput = { iteration: 1, previousOutput: { done: true } }
    // At the start of iteration 1 (the second pass), condition is evaluated
    // with input = { iteration: 1, previousOutput: { done: true } }.
    // "input.done === true" → resolveLoopValue("input.done", input) → undefined
    // because the wrapped object has .iteration and .previousOutput, not .done.
    // So we need the initial input to NOT have done, and after wrapping it won't
    // have done at the top level either. Let's test the truthy path instead.
    //
    // Actually re-reading the code: after iteration 0, currentInput becomes
    // { iteration: 1, previousOutput: originalInput }. So "input.done" on that
    // object resolves to undefined. The loop would break when the condition is
    // false (undefined is falsy).
    //
    // A more realistic test: "input.previousOutput.done === true" checks the
    // nested previous output. But let's test the simpler path as requested.

    // With initial input { done: true }, first iteration runs (condition skipped).
    // At iteration 1, currentInput = { iteration: 1, previousOutput: { done: true } }.
    // "input.done === true": resolveLoopValue("input.done") on the wrapped object
    // returns undefined, parseLoopValue("true") returns true.
    // undefined === true → false → break. So we get 1 iteration.
    const node = makeNode("loop-input", { maxIterations: 10, condition: "input.done === true" });
    const result = await executeLoopNode(node, { done: true }, makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number; outputs: unknown[] };
    // After iteration 0 the input is wrapped, so input.done is undefined → break
    expect(out.iterations).toBe(1);
  });

  it("continues when input-based condition evaluates truthy", async () => {
    // Use "input.previousOutput" — after first iteration currentInput is
    // { iteration: 1, previousOutput: "init" }. At iteration 1 the condition
    // resolves input.previousOutput → "init" (truthy) → continue. At
    // iteration 2 currentInput is { iteration: 2, previousOutput: { iteration: 1, … } },
    // input.previousOutput is an object (truthy) → continue. Runs all 3.
    const node = makeNode("loop-truthy", { maxIterations: 3, condition: "input.previousOutput" });
    const result = await executeLoopNode(node, "init", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number };
    expect(out.iterations).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 7. Output structure: { iterations, lastOutput, outputs }
  // -------------------------------------------------------------------------
  it("output contains iterations count, lastOutput, and outputs array", async () => {
    const node = makeNode("loop-struct", { maxIterations: 2, condition: "" });
    const result = await executeLoopNode(node, "seed", makeContext());

    expect(result.status).toBe("success");

    const out = result.output as { iterations: number; lastOutput: unknown; outputs: unknown[] };

    // iterations = 2
    expect(out.iterations).toBe(2);

    // outputs array has one entry per iteration (the input at that iteration)
    expect(out.outputs).toHaveLength(2);
    expect(out.outputs[0]).toBe("seed"); // first iteration gets the original input

    // Second iteration input is wrapped
    expect(out.outputs[1]).toEqual({ iteration: 1, previousOutput: "seed" });

    // lastOutput is the final currentInput after wrapping
    expect(out.lastOutput).toEqual({
      iteration: 2,
      previousOutput: { iteration: 1, previousOutput: "seed" },
    });
  });

  it("outputs accumulate correctly across iterations", async () => {
    const node = makeNode("loop-accum", { maxIterations: 4, condition: "" });
    const result = await executeLoopNode(node, 0, makeContext());
    const out = result.output as { iterations: number; outputs: unknown[] };

    expect(out.iterations).toBe(4);
    expect(out.outputs[0]).toBe(0);
    expect(out.outputs[1]).toEqual({ iteration: 1, previousOutput: 0 });
    expect(out.outputs[2]).toEqual({
      iteration: 2,
      previousOutput: { iteration: 1, previousOutput: 0 },
    });
    expect(out.outputs[3]).toEqual({
      iteration: 3,
      previousOutput: {
        iteration: 2,
        previousOutput: { iteration: 1, previousOutput: 0 },
      },
    });
  });

  // -------------------------------------------------------------------------
  // 8. outputHandle is always "done"
  // -------------------------------------------------------------------------
  it('sets outputHandle to "done" on success', async () => {
    const node = makeNode("loop-handle", { maxIterations: 1, condition: "" });
    const result = await executeLoopNode(node, null, makeContext());

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("done");
  });

  it('sets outputHandle to "done" even with condition-based early exit', async () => {
    const node = makeNode("loop-handle2", { maxIterations: 10, condition: "false" });
    const result = await executeLoopNode(node, null, makeContext());

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("done");
  });

  // -------------------------------------------------------------------------
  // 9. Input is passed through as initial input
  // -------------------------------------------------------------------------
  it("passes the original input as the first iteration input", async () => {
    const inputData = { key: "value", nested: { a: 1 } };
    const node = makeNode("loop-passthrough", { maxIterations: 1, condition: "" });
    const result = await executeLoopNode(node, inputData, makeContext());

    const out = result.output as { outputs: unknown[] };
    expect(out.outputs[0]).toEqual(inputData);
  });

  it("handles undefined input gracefully", async () => {
    const node = makeNode("loop-undef", { maxIterations: 2, condition: "" });
    const result = await executeLoopNode(node, undefined, makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number; outputs: unknown[] };
    expect(out.iterations).toBe(2);
    expect(out.outputs[0]).toBeUndefined();
    expect(out.outputs[1]).toEqual({ iteration: 1, previousOutput: undefined });
  });

  it("handles null input gracefully", async () => {
    const node = makeNode("loop-null", { maxIterations: 1, condition: "" });
    const result = await executeLoopNode(node, null, makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { outputs: unknown[] };
    expect(out.outputs[0]).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 10. Exception during execution returns failure
  // -------------------------------------------------------------------------
  it("returns failure when an exception is thrown (Error)", async () => {
    // The condition is evaluated inside the try block (line 40). We set a
    // condition that accesses input.previousOutput.boom. After iteration 0,
    // currentInput = { iteration: 1, previousOutput: trapInput }. The
    // condition resolver traverses into previousOutput and hits the getter.
    const trapInput = {};
    Object.defineProperty(trapInput, "boom", {
      get() {
        throw new Error("condition exploded");
      },
      enumerable: true,
    });

    const node = makeNode("loop-throw", {
      maxIterations: 5,
      condition: "input.previousOutput.boom",
    });
    const ctx = makeContext();
    const result = await executeLoopNode(node, trapInput, ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toBe("condition exploded");
    expect(result.durationMs).toBeTypeOf("number");
    expect(ctx.log!.error).toHaveBeenCalled();
  });

  it("returns failure with stringified error for non-Error exceptions", async () => {
    const trapInput = {};
    Object.defineProperty(trapInput, "boom", {
      get() {
        throw "string error"; // eslint-disable-line no-throw-literal
      },
      enumerable: true,
    });

    const node = makeNode("loop-throw2", {
      maxIterations: 5,
      condition: "input.previousOutput.boom",
    });
    const ctx = makeContext();
    const result = await executeLoopNode(node, trapInput, ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toBe("string error");
  });

  // -------------------------------------------------------------------------
  // Additional edge cases
  // -------------------------------------------------------------------------

  it("includes durationMs in successful results", async () => {
    const node = makeNode("loop-dur", { maxIterations: 1, condition: "" });
    const result = await executeLoopNode(node, null, makeContext());

    expect(result.status).toBe("success");
    expect(result.durationMs).toBeTypeOf("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes durationMs in failure results", async () => {
    const node = makeNode("loop-dur-fail", { maxIterations: 0 });
    const result = await executeLoopNode(node, null, makeContext());

    expect(result.status).toBe("failure");
    expect(result.durationMs).toBeTypeOf("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("works with maxIterations = 1", async () => {
    const node = makeNode("loop-one", { maxIterations: 1, condition: "" });
    const result = await executeLoopNode(node, "only", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number; outputs: unknown[]; lastOutput: unknown };
    expect(out.iterations).toBe(1);
    expect(out.outputs).toEqual(["only"]);
    expect(out.lastOutput).toEqual({ iteration: 1, previousOutput: "only" });
  });

  it("handles !== condition operator", async () => {
    const node = makeNode("loop-neq", { maxIterations: 5, condition: "iteration !== 2" });
    const result = await executeLoopNode(node, "init", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number };
    // iteration 0: condition skipped → runs
    // iteration 1: 1 !== 2 → true → runs
    // iteration 2: 2 !== 2 → false → break
    expect(out.iterations).toBe(2);
  });

  it("handles >= condition operator", async () => {
    const node = makeNode("loop-gte", { maxIterations: 5, condition: "iteration >= 3" });
    const result = await executeLoopNode(node, "init", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number };
    // iteration 0: skipped → runs
    // iteration 1: 1 >= 3 → false → break
    expect(out.iterations).toBe(1);
  });

  it("handles === condition with string comparison", async () => {
    // After iteration 0, currentInput wraps to { iteration: 1, previousOutput: "hello" }
    // "input.previousOutput === hello" resolves LHS to "hello", RHS parsed as string "hello"
    // But parseLoopValue("hello") returns "hello" (no quotes), so "hello" === "hello" → true
    const node = makeNode("loop-streq", {
      maxIterations: 3,
      condition: 'input.previousOutput === "hello"',
    });
    const result = await executeLoopNode(node, "hello", makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number };
    // iteration 0: skipped → runs
    // iteration 1: input.previousOutput = "hello", "hello" === "hello" → true → runs
    // iteration 2: input.previousOutput = { iteration: 1, ... }, resolves to object !== "hello" → break
    expect(out.iterations).toBe(2);
  });

  it("works without log in context", async () => {
    const node = makeNode("loop-nolog", { maxIterations: 2, condition: "" });
    const result = await executeLoopNode(node, "x", {});

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number };
    expect(out.iterations).toBe(2);
  });

  it("error path works without log in context", async () => {
    const trapInput = {};
    Object.defineProperty(trapInput, "kaboom", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
    });

    const node = makeNode("loop-nolog-err", {
      maxIterations: 5,
      condition: "input.previousOutput.kaboom",
    });

    // Should not throw even though log is undefined
    const result = await executeLoopNode(node, trapInput, {});

    expect(result.status).toBe("failure");
    expect(result.error).toBe("boom");
  });

  it("handles deeply nested input path resolution", async () => {
    // After first iteration: currentInput = { iteration: 1, previousOutput: { a: { b: { c: 42 } } } }
    // "input.previousOutput.a.b.c" should resolve to 42
    const node = makeNode("loop-deep", {
      maxIterations: 10,
      condition: "input.previousOutput.a.b.c === 42",
    });
    const result = await executeLoopNode(node, { a: { b: { c: 42 } } }, makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number };
    // iteration 0: skipped → runs
    // iteration 1: input.previousOutput = { a: { b: { c: 42 } } }, 42 === 42 → true → runs
    // iteration 2: input.previousOutput = { iteration: 1, ... }, path resolves to undefined → break
    expect(out.iterations).toBe(2);
  });

  it("condition with whitespace is trimmed", async () => {
    const node = makeNode("loop-ws", { maxIterations: 5, condition: "  false  " });
    const result = await executeLoopNode(node, null, makeContext());

    expect(result.status).toBe("success");
    const out = result.output as { iterations: number };
    expect(out.iterations).toBe(1);
  });
});

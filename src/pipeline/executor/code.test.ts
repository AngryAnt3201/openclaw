import { describe, it, expect, vi } from "vitest";
import type { PipelineNode, NodeConfig } from "../types.js";
import type { ExecutorContext } from "./types.js";
import { executeCodeNode } from "./code.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const DEFAULT_STATE = { status: "idle" as const, retryCount: 0 };

function makeNode(id: string, config: Record<string, unknown> = {}): PipelineNode {
  return {
    id,
    type: "code",
    label: id,
    config: { description: "", ...config } as NodeConfig,
    position: { x: 0, y: 0 },
    state: { ...DEFAULT_STATE },
  };
}

function makeContext(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    runIsolatedAgentJob: vi.fn().mockResolvedValue({ status: "ok", summary: "done" }),
    log: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeCodeNode", () => {
  // -----------------------------------------------------------------------
  // 1. Missing description returns failure
  // -----------------------------------------------------------------------
  it("returns failure when description is missing", async () => {
    const node = makeNode("no-desc", { description: "" });
    const result = await executeCodeNode(node, undefined, makeContext());
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/description/i);
    expect(result.durationMs).toBeTypeOf("number");
  });

  it("returns failure when description is undefined", async () => {
    const node = makeNode("no-desc", { description: undefined });
    const result = await executeCodeNode(node, undefined, makeContext());
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/description/i);
  });

  // -----------------------------------------------------------------------
  // 2. Missing runIsolatedAgentJob returns failure with specific error
  // -----------------------------------------------------------------------
  it("returns failure when runIsolatedAgentJob is not available", async () => {
    const node = makeNode("no-runner", { description: "do stuff" });
    const ctx = makeContext({ runIsolatedAgentJob: undefined });
    const result = await executeCodeNode(node, undefined, ctx);
    expect(result.status).toBe("failure");
    expect(result.error).toBe("runIsolatedAgentJob not available in executor context");
    expect(result.durationMs).toBeTypeOf("number");
  });

  // -----------------------------------------------------------------------
  // 3. Successful execution — runIsolatedAgentJob returns ok
  // -----------------------------------------------------------------------
  it("returns success when runIsolatedAgentJob returns status ok", async () => {
    const node = makeNode("ok-node", { description: "compute sum" });
    const ctx = makeContext({
      runIsolatedAgentJob: vi.fn().mockResolvedValue({ status: "ok", summary: "result is 42" }),
    });
    const result = await executeCodeNode(node, undefined, ctx);
    expect(result.status).toBe("success");
    expect(result.output).toBe("result is 42");
    expect(result.durationMs).toBeTypeOf("number");
    expect(result.error).toBeUndefined();
  });

  it("falls back to full result object when summary is missing on ok", async () => {
    const fullResult = { status: "ok" };
    const ctx = makeContext({
      runIsolatedAgentJob: vi.fn().mockResolvedValue(fullResult),
    });
    const node = makeNode("ok-no-summary", { description: "run something" });
    const result = await executeCodeNode(node, undefined, ctx);
    expect(result.status).toBe("success");
    expect(result.output).toEqual(fullResult);
  });

  // -----------------------------------------------------------------------
  // 4. Failed execution — runIsolatedAgentJob returns error
  // -----------------------------------------------------------------------
  it("returns failure when runIsolatedAgentJob returns status error", async () => {
    const node = makeNode("err-node", { description: "bad code" });
    const ctx = makeContext({
      runIsolatedAgentJob: vi.fn().mockResolvedValue({
        status: "error",
        error: "something broke",
        summary: "partial output",
      }),
    });
    const result = await executeCodeNode(node, undefined, ctx);
    expect(result.status).toBe("failure");
    expect(result.error).toBe("something broke");
    expect(result.output).toBe("partial output");
    expect(result.durationMs).toBeTypeOf("number");
  });

  it("uses default error message when error field is missing on failure", async () => {
    const ctx = makeContext({
      runIsolatedAgentJob: vi.fn().mockResolvedValue({ status: "error" }),
    });
    const node = makeNode("err-no-msg", { description: "fail silently" });
    const result = await executeCodeNode(node, undefined, ctx);
    expect(result.status).toBe("failure");
    expect(result.error).toBe("Code execution failed");
  });

  // -----------------------------------------------------------------------
  // 5. Input is included in the prompt when provided
  // -----------------------------------------------------------------------
  it("includes string input in the prompt", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("with-input", { description: "process data" });

    await executeCodeNode(node, "upstream string data", ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).toContain("upstream string data");
    expect(message).toContain("Pipeline variables");
  });

  it("includes object input as JSON in the prompt", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("with-obj-input", { description: "process data" });
    const input = { key: "value", count: 42 };

    await executeCodeNode(node, input, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).toContain('"key": "value"');
    expect(message).toContain('"count": 42');
    expect(message).toContain("Pipeline variables");
  });

  // -----------------------------------------------------------------------
  // 6. Input is NOT included when undefined/null
  // -----------------------------------------------------------------------
  it("does not include pipeline variables section when input is undefined", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("no-input", { description: "standalone code" });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).not.toContain("Pipeline variables");
  });

  it("does not include pipeline variables section when input is null", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("null-input", { description: "standalone code" });

    await executeCodeNode(node, null, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).not.toContain("Pipeline variables");
  });

  // -----------------------------------------------------------------------
  // 7. Language preference is included in prompt when set and not "auto"
  // -----------------------------------------------------------------------
  it("includes language preference in prompt when explicitly set", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("lang-python", { description: "sort a list", language: "python" });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).toContain("Preferred language: python");
  });

  it("includes language preference for typescript", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("lang-ts", { description: "parse JSON", language: "typescript" });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).toContain("Preferred language: typescript");
  });

  // -----------------------------------------------------------------------
  // 8. Language "auto" is NOT included in prompt
  // -----------------------------------------------------------------------
  it("does not include language preference when set to auto", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("lang-auto", { description: "run code", language: "auto" });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).not.toContain("Preferred language");
  });

  it("does not include language preference when language is unset", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("no-lang", { description: "run code" });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).not.toContain("Preferred language");
  });

  // -----------------------------------------------------------------------
  // 9. maxRetries value is mentioned in prompt
  // -----------------------------------------------------------------------
  it("mentions custom maxRetries value in the prompt", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("retries", { description: "flaky task", maxRetries: 5 });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).toContain("up to 5 attempts");
  });

  it("defaults maxRetries to 3 in the prompt when not specified", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("default-retries", { description: "some task" });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).toContain("up to 3 attempts");
  });

  // -----------------------------------------------------------------------
  // 10. timeout is passed to runIsolatedAgentJob as timeoutSeconds
  // -----------------------------------------------------------------------
  it("passes custom timeout as timeoutSeconds", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("custom-timeout", { description: "long task", timeout: 300 });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.timeoutSeconds).toBe(300);
  });

  // -----------------------------------------------------------------------
  // 11. tools: ["execute_code"] is always passed
  // -----------------------------------------------------------------------
  it("always passes tools: ['execute_code'] to runIsolatedAgentJob", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("tools-check", { description: "any task" });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.tools).toEqual(["execute_code"]);
  });

  it("passes execute_code tool even when language and input are set", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("tools-full", {
      description: "compute",
      language: "rust",
      timeout: 60,
      maxRetries: 2,
    });

    await executeCodeNode(node, { data: "input" }, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.tools).toEqual(["execute_code"]);
  });

  // -----------------------------------------------------------------------
  // 12. Exception thrown by runIsolatedAgentJob is caught
  // -----------------------------------------------------------------------
  it("catches exception thrown by runIsolatedAgentJob and returns failure", async () => {
    const ctx = makeContext({
      runIsolatedAgentJob: vi.fn().mockRejectedValue(new Error("network timeout")),
    });
    const node = makeNode("throw-err", { description: "will fail" });
    const result = await executeCodeNode(node, undefined, ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toBe("network timeout");
    expect(result.durationMs).toBeTypeOf("number");
  });

  it("catches non-Error exceptions and stringifies them", async () => {
    const ctx = makeContext({
      runIsolatedAgentJob: vi.fn().mockRejectedValue("string error"),
    });
    const node = makeNode("throw-str", { description: "will fail" });
    const result = await executeCodeNode(node, undefined, ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toBe("string error");
  });

  it("logs the error when an exception is thrown", async () => {
    const logError = vi.fn();
    const ctx = makeContext({
      runIsolatedAgentJob: vi.fn().mockRejectedValue(new Error("boom")),
      log: { info: vi.fn(), error: logError },
    });
    const node = makeNode("log-err", { description: "will fail" });
    await executeCodeNode(node, undefined, ctx);

    expect(logError).toHaveBeenCalledWith("Pipeline code node failed:", expect.any(Error));
  });

  // -----------------------------------------------------------------------
  // 13. Default timeout (120) is used when not specified
  // -----------------------------------------------------------------------
  it("uses default timeout of 120 when not specified in config", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("default-timeout", { description: "quick task" });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.timeoutSeconds).toBe(120);
  });

  it("uses default timeout of 120 when timeout is explicitly undefined", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("undef-timeout", { description: "task", timeout: undefined });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.timeoutSeconds).toBe(120);
  });

  // -----------------------------------------------------------------------
  // Edge: prompt structure is well-formed
  // -----------------------------------------------------------------------
  it("includes the task description in the prompt", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("desc-check", { description: "calculate fibonacci sequence" });

    await executeCodeNode(node, undefined, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;
    expect(message).toContain("calculate fibonacci sequence");
    expect(message).toContain("[Task]");
    expect(message).toContain("execute_code tool");
  });

  it("includes the complete prompt structure with input", async () => {
    const runJob = vi.fn().mockResolvedValue({ status: "ok", summary: "ok" });
    const ctx = makeContext({ runIsolatedAgentJob: runJob });
    const node = makeNode("full-prompt", {
      description: "sort the data",
      language: "python",
      maxRetries: 2,
    });

    await executeCodeNode(node, { items: [3, 1, 2] }, ctx);

    const callArgs = runJob.mock.calls[0][0] as Record<string, unknown>;
    const message = callArgs.message as string;

    // Input section comes before task section
    const inputIdx = message.indexOf("Pipeline variables");
    const taskIdx = message.indexOf("[Task]");
    expect(inputIdx).toBeLessThan(taskIdx);
    expect(inputIdx).toBeGreaterThanOrEqual(0);

    // All sections present
    expect(message).toContain("sort the data");
    expect(message).toContain("Preferred language: python");
    expect(message).toContain("up to 2 attempts");
    expect(message).toContain("Return your final result");
  });
});

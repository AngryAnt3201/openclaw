import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PipelineNode } from "../types.js";
import type { ExecutorContext } from "./types.js";
import { executeApprovalNode } from "./approval.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApprovalNode(overrides: Record<string, unknown> = {}): PipelineNode {
  return {
    id: "approval-1",
    type: "approval",
    label: "Test Approval Node",
    config: {
      kind: "approval" as const,
      message: "Please approve this deployment",
      ...overrides,
    },
    position: { x: 0, y: 0 },
    state: { status: "idle", retryCount: 0 },
  };
}

function makeContext(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    callGatewayRpc: vi.fn(),
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn(),
    log: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeApprovalNode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // 1. Missing message returns failure
  // -----------------------------------------------------------------------
  it("returns failure when message is missing", async () => {
    const node = makeApprovalNode({ message: "" });
    const result = await executeApprovalNode(node, undefined, makeContext());
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/message/i);
  });

  it("returns failure when message is undefined", async () => {
    const node = makeApprovalNode({ message: undefined });
    const result = await executeApprovalNode(node, undefined, makeContext());
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/message/i);
  });

  // -----------------------------------------------------------------------
  // 2. Missing callGatewayRpc returns failure
  // -----------------------------------------------------------------------
  it("returns failure when callGatewayRpc is not available", async () => {
    const node = makeApprovalNode();
    const result = await executeApprovalNode(node, undefined, {
      log: { info: vi.fn(), error: vi.fn() },
    });
    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/callGatewayRpc/i);
  });

  // -----------------------------------------------------------------------
  // 3. Successful approval flow
  // -----------------------------------------------------------------------
  it("returns approved when task is completed with non-rejected resolution", async () => {
    const rpc = vi
      .fn()
      // task.create
      .mockResolvedValueOnce({ id: "task-abc" })
      // task.get — completed with "approved"
      .mockResolvedValueOnce({ status: "completed", resolution: "approved" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, undefined, ctx);

    // Advance past the POLL_INTERVAL_MS sleep
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("approved");
    expect(result.output).toEqual(
      expect.objectContaining({
        approved: true,
        taskId: "task-abc",
        resolution: "approved",
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "task.create",
      expect.objectContaining({
        title: expect.stringContaining("Test Approval Node"),
        description: "Please approve this deployment",
        type: "approval",
        priority: "high",
      }),
    );
    expect(rpc).toHaveBeenCalledWith("task.get", { id: "task-abc" });
  });

  // -----------------------------------------------------------------------
  // 4. Denial flow (rejected resolution)
  // -----------------------------------------------------------------------
  it("returns denied when task is completed with rejected resolution", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-def" })
      .mockResolvedValueOnce({ status: "completed", resolution: "rejected" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("denied");
    expect(result.output).toEqual(
      expect.objectContaining({
        approved: false,
        taskId: "task-def",
        resolution: "rejected",
      }),
    );
  });

  // -----------------------------------------------------------------------
  // 5. Task cancelled → denied
  // -----------------------------------------------------------------------
  it("returns denied when task is cancelled", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-can" })
      .mockResolvedValueOnce({ status: "cancelled" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("denied");
    expect(result.output).toEqual(
      expect.objectContaining({
        approved: false,
        taskId: "task-can",
        resolution: "cancelled",
      }),
    );
  });

  it("returns denied when task has failed status", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-fail" })
      .mockResolvedValueOnce({ status: "failed" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("denied");
    expect(result.output).toEqual(
      expect.objectContaining({
        approved: false,
        taskId: "task-fail",
        resolution: "failed",
      }),
    );
  });

  // -----------------------------------------------------------------------
  // 6. Timeout with default action (deny)
  // -----------------------------------------------------------------------
  it("returns denied on timeout with default deny action", async () => {
    const rpc = vi
      .fn()
      // task.create
      .mockResolvedValueOnce({ id: "task-timeout" })
      // task.get — always pending (never completes)
      .mockResolvedValue({ status: "pending" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    // Use a tiny timeout so the deadline is hit immediately
    const node = makeApprovalNode({ timeoutSec: 0.001 });

    const promise = executeApprovalNode(node, undefined, ctx);
    // Advance past both the tiny timeout and the first poll interval
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("denied");
    expect(result.output).toEqual(
      expect.objectContaining({
        approved: false,
        taskId: "task-timeout",
        timedOut: true,
      }),
    );
  });

  it("returns denied on timeout when timeoutAction is explicitly deny", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-deny" })
      .mockResolvedValue({ status: "pending" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 0.001, timeoutAction: "deny" });

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("denied");
    expect(result.output).toEqual(
      expect.objectContaining({
        approved: false,
        timedOut: true,
      }),
    );
  });

  // -----------------------------------------------------------------------
  // 7. Timeout with "skip" action → skipped status
  // -----------------------------------------------------------------------
  it("returns skipped status on timeout when timeoutAction is skip", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-skip" })
      .mockResolvedValue({ status: "pending" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 0.001, timeoutAction: "skip" });

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("skipped");
    expect(result.output).toEqual(
      expect.objectContaining({
        timedOut: true,
        taskId: "task-skip",
      }),
    );
    // skipped should not set an outputHandle
    expect(result.outputHandle).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 8. Input context is appended to approval message
  // -----------------------------------------------------------------------
  it("appends string input as context to the approval message", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-ctx" })
      .mockResolvedValueOnce({ status: "completed", resolution: "approved" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, "Build succeeded on branch main", ctx);
    await vi.advanceTimersByTimeAsync(2_100);
    await promise;

    const createCall = rpc.mock.calls[0];
    expect(createCall[0]).toBe("task.create");
    const description = createCall[1] as { description: string };
    expect(description.description).toContain("Please approve this deployment");
    expect(description.description).toContain("[Context from previous step]");
    expect(description.description).toContain("Build succeeded on branch main");
  });

  it("appends object input as JSON context to the approval message", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-ctx2" })
      .mockResolvedValueOnce({ status: "completed", resolution: "approved" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const inputObj = { branch: "main", tests: 42, passing: true };
    const promise = executeApprovalNode(node, inputObj, ctx);
    await vi.advanceTimersByTimeAsync(2_100);
    await promise;

    const createCall = rpc.mock.calls[0];
    const description = (createCall[1] as { description: string }).description;
    expect(description).toContain("[Context from previous step]");
    expect(description).toContain('"branch": "main"');
    expect(description).toContain('"tests": 42');
  });

  it("does not append context when input is null", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-null" })
      .mockResolvedValueOnce({ status: "completed", resolution: "approved" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, null, ctx);
    await vi.advanceTimersByTimeAsync(2_100);
    await promise;

    const createCall = rpc.mock.calls[0];
    const description = (createCall[1] as { description: string }).description;
    expect(description).toBe("Please approve this deployment");
    expect(description).not.toContain("[Context from previous step]");
  });

  it("does not append context when input is undefined", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-undef" })
      .mockResolvedValueOnce({ status: "completed", resolution: "approved" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);
    await promise;

    const createCall = rpc.mock.calls[0];
    const description = (createCall[1] as { description: string }).description;
    expect(description).toBe("Please approve this deployment");
  });

  it("does not append context when input is an empty object", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-empty" })
      .mockResolvedValueOnce({ status: "completed", resolution: "approved" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, {}, ctx);
    await vi.advanceTimersByTimeAsync(2_100);
    await promise;

    const createCall = rpc.mock.calls[0];
    const description = (createCall[1] as { description: string }).description;
    expect(description).toBe("Please approve this deployment");
    expect(description).not.toContain("[Context from previous step]");
  });

  // -----------------------------------------------------------------------
  // 9. Task creation failure returns failure
  // -----------------------------------------------------------------------
  it("returns failure when task.create returns null", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(null);

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode();

    const result = await executeApprovalNode(node, undefined, ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/Failed to create/i);
  });

  it("returns failure when task.create returns object without id", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ status: "ok" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode();

    const result = await executeApprovalNode(node, undefined, ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toMatch(/Failed to create/i);
  });

  // -----------------------------------------------------------------------
  // 10. Exception during execution returns failure
  // -----------------------------------------------------------------------
  it("returns failure when callGatewayRpc throws an Error", async () => {
    const rpc = vi.fn().mockRejectedValueOnce(new Error("RPC connection lost"));

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode();

    const result = await executeApprovalNode(node, undefined, ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toBe("RPC connection lost");
    expect(result.durationMs).toBeDefined();
  });

  it("returns failure and stringifies non-Error throws", async () => {
    const rpc = vi.fn().mockRejectedValueOnce("network failure");

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode();

    const result = await executeApprovalNode(node, undefined, ctx);

    expect(result.status).toBe("failure");
    expect(result.error).toBe("network failure");
  });

  it("logs the error when an exception occurs", async () => {
    const logError = vi.fn();
    const rpc = vi.fn().mockRejectedValueOnce(new Error("boom"));

    const ctx = makeContext({
      callGatewayRpc: rpc,
      log: { info: vi.fn(), error: logError },
    });
    const node = makeApprovalNode();

    await executeApprovalNode(node, undefined, ctx);

    expect(logError).toHaveBeenCalledWith("Pipeline approval node failed:", expect.any(Error));
  });

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------
  it("continues polling when task.get returns null", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-retry" })
      // First poll: null (should continue)
      .mockResolvedValueOnce(null)
      // Second poll: still pending
      .mockResolvedValueOnce({ status: "pending" })
      // Third poll: approved
      .mockResolvedValueOnce({ status: "completed", resolution: "approved" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, undefined, ctx);

    // Advance through three poll intervals
    await vi.advanceTimersByTimeAsync(2_100);
    await vi.advanceTimersByTimeAsync(2_100);
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("approved");
    // task.create + 3 task.get calls
    expect(rpc).toHaveBeenCalledTimes(4);
  });

  it("includes pipelineNodeId in task metadata", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-meta" })
      .mockResolvedValueOnce({ status: "completed", resolution: "approved" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode();
    node.id = "custom-node-id-123";

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);
    await promise;

    expect(rpc).toHaveBeenCalledWith(
      "task.create",
      expect.objectContaining({
        metadata: expect.objectContaining({
          pipelineNodeId: "custom-node-id-123",
          source: "pipeline",
        }),
      }),
    );
  });

  it("uses node label in the task title", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-label" })
      .mockResolvedValueOnce({ status: "completed", resolution: "approved" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode();
    node.label = "Deploy to Production";

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);
    await promise;

    expect(rpc).toHaveBeenCalledWith(
      "task.create",
      expect.objectContaining({
        title: "Pipeline Approval: Deploy to Production",
      }),
    );
  });

  it("sets durationMs on all result types", async () => {
    // Failure path (missing message)
    const result1 = await executeApprovalNode(
      makeApprovalNode({ message: "" }),
      undefined,
      makeContext(),
    );
    expect(typeof result1.durationMs).toBe("number");
    expect(result1.durationMs).toBeGreaterThanOrEqual(0);

    // Failure path (missing callGatewayRpc)
    const result2 = await executeApprovalNode(makeApprovalNode(), undefined, {
      log: { info: vi.fn(), error: vi.fn() },
    });
    expect(typeof result2.durationMs).toBe("number");
  });

  it("treats non-rejected resolution on completed task as approved", async () => {
    // Resolution could be anything other than "rejected" and still count as approved
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-custom-res" })
      .mockResolvedValueOnce({ status: "completed", resolution: "custom_resolution" });

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("success");
    expect(result.outputHandle).toBe("approved");
    expect(result.output).toEqual(expect.objectContaining({ approved: true }));
  });

  it("exception during polling returns failure", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ id: "task-poll-err" })
      // Polling call throws
      .mockRejectedValueOnce(new Error("connection reset"));

    const ctx = makeContext({ callGatewayRpc: rpc });
    const node = makeApprovalNode({ timeoutSec: 30 });

    const promise = executeApprovalNode(node, undefined, ctx);
    await vi.advanceTimersByTimeAsync(2_100);

    const result = await promise;

    expect(result.status).toBe("failure");
    expect(result.error).toBe("connection reset");
  });
});

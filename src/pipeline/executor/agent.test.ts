// ---------------------------------------------------------------------------
// Pipeline Executor – Agent Node Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import type { PipelineNode, NodeConfig } from "../types.js";
import type { ExecutorContext } from "./types.js";
import { executeAgentNode } from "./agent.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const DEFAULT_STATE = { status: "idle" as const, retryCount: 0 };

function makeNode(config: Record<string, unknown> = {}): PipelineNode {
  return {
    id: "agent-1",
    type: "agent",
    label: "Test Agent",
    config: {
      kind: "agent",
      prompt: "do something",
      skills: [],
      credentials: [],
      sessionTarget: "isolated",
      ...config,
    } as NodeConfig,
    position: { x: 0, y: 0 },
    state: { ...DEFAULT_STATE },
  };
}

function makeContext(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    enqueueSystemEvent: vi.fn(),
    requestHeartbeatNow: vi.fn(),
    runIsolatedAgentJob: vi.fn().mockResolvedValue({ status: "ok", summary: "done" }),
    log: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("executeAgentNode", () => {
  // --- Validation ---

  it("returns failure when prompt is missing", async () => {
    const result = await executeAgentNode(makeNode({ prompt: "" }), undefined, makeContext());

    expect(result.status).toBe("failure");
    expect(result.error).toContain("prompt");
  });

  // --- Main session path ---

  describe("sessionTarget: main", () => {
    it("enqueues system event and requests heartbeat", async () => {
      const ctx = makeContext();
      const result = await executeAgentNode(
        makeNode({ sessionTarget: "main", prompt: "deploy now" }),
        undefined,
        ctx,
      );

      expect(result.status).toBe("success");
      expect(ctx.enqueueSystemEvent).toHaveBeenCalledTimes(1);
      expect(ctx.requestHeartbeatNow).toHaveBeenCalledWith({ reason: "pipeline:agent" });
      expect(result.output).toMatchObject({ dispatched: true, sessionTarget: "main" });
    });

    it("returns failure when enqueueSystemEvent is not available", async () => {
      const result = await executeAgentNode(
        makeNode({ sessionTarget: "main" }),
        undefined,
        makeContext({ enqueueSystemEvent: undefined }),
      );

      expect(result.status).toBe("failure");
      expect(result.error).toContain("enqueueSystemEvent");
    });

    it("includes upstream input in the prompt", async () => {
      const ctx = makeContext();
      await executeAgentNode(
        makeNode({ sessionTarget: "main", prompt: "analyze this" }),
        { data: "from upstream" },
        ctx,
      );

      const callArg = (ctx.enqueueSystemEvent as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(callArg).toContain("from upstream");
      expect(callArg).toContain("analyze this");
    });
  });

  // --- Isolated session path ---

  describe("sessionTarget: isolated", () => {
    it("calls runIsolatedAgentJob and returns result", async () => {
      const ctx = makeContext();
      const result = await executeAgentNode(
        makeNode({ sessionTarget: "isolated", prompt: "research topic" }),
        undefined,
        ctx,
      );

      expect(result.status).toBe("success");
      expect(ctx.runIsolatedAgentJob).toHaveBeenCalledTimes(1);
      expect(result.output).toEqual({ status: "ok", summary: "done" });
    });

    it("returns failure when runIsolatedAgentJob is not available", async () => {
      const result = await executeAgentNode(
        makeNode({ sessionTarget: "isolated" }),
        undefined,
        makeContext({ runIsolatedAgentJob: undefined }),
      );

      expect(result.status).toBe("failure");
      expect(result.error).toContain("runIsolatedAgentJob");
    });

    it("passes model, skills, thinking, timeout to runIsolatedAgentJob", async () => {
      const ctx = makeContext();
      await executeAgentNode(
        makeNode({
          sessionTarget: "isolated",
          prompt: "go",
          model: "claude-3",
          skills: ["coding", "github"],
          thinking: "high",
          timeout: 600,
        }),
        undefined,
        ctx,
      );

      const callArgs = (ctx.runIsolatedAgentJob as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.model).toBe("claude-3");
      expect(callArgs.skills).toEqual(["coding", "github"]);
      expect(callArgs.thinking).toBe("high");
      expect(callArgs.timeoutSeconds).toBe(600);
    });

    it("uses default timeout (300s) when not specified", async () => {
      const ctx = makeContext();
      await executeAgentNode(makeNode({ sessionTarget: "isolated", prompt: "go" }), undefined, ctx);

      const callArgs = (ctx.runIsolatedAgentJob as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.timeoutSeconds).toBe(300);
    });

    it("passes upstream input as previousOutput", async () => {
      const ctx = makeContext();
      const input = { upstream: "data" };
      await executeAgentNode(makeNode({ sessionTarget: "isolated", prompt: "go" }), input, ctx);

      const callArgs = (ctx.runIsolatedAgentJob as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.previousOutput).toEqual(input);
    });

    it("includes input context in the message", async () => {
      const ctx = makeContext();
      await executeAgentNode(
        makeNode({ sessionTarget: "isolated", prompt: "analyze" }),
        { value: 42 },
        ctx,
      );

      const callArgs = (ctx.runIsolatedAgentJob as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.message).toContain("42");
      expect(callArgs.message).toContain("analyze");
    });

    it("agent job returning error status → failure result", async () => {
      const ctx = makeContext({
        runIsolatedAgentJob: vi.fn().mockResolvedValue({
          status: "error",
          error: "model overloaded",
        }),
      });

      const result = await executeAgentNode(
        makeNode({ sessionTarget: "isolated", prompt: "go" }),
        undefined,
        ctx,
      );

      expect(result.status).toBe("failure");
      expect(result.error).toBe("model overloaded");
    });

    it("runIsolatedAgentJob throwing is caught", async () => {
      const ctx = makeContext({
        runIsolatedAgentJob: vi.fn().mockRejectedValue(new Error("connection reset")),
      });

      const result = await executeAgentNode(
        makeNode({ sessionTarget: "isolated", prompt: "go" }),
        undefined,
        ctx,
      );

      expect(result.status).toBe("failure");
      expect(result.error).toBe("connection reset");
    });
  });

  // --- Input handling ---

  describe("input handling", () => {
    it("undefined input does not add context prefix to prompt", async () => {
      const ctx = makeContext();
      await executeAgentNode(
        makeNode({ sessionTarget: "isolated", prompt: "hello world" }),
        undefined,
        ctx,
      );

      const callArgs = (ctx.runIsolatedAgentJob as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.message).toBe("hello world");
    });

    it("null input does not add context prefix to prompt", async () => {
      const ctx = makeContext();
      await executeAgentNode(
        makeNode({ sessionTarget: "isolated", prompt: "hello world" }),
        null,
        ctx,
      );

      const callArgs = (ctx.runIsolatedAgentJob as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.message).toBe("hello world");
    });

    it("empty object input does not add context prefix", async () => {
      const ctx = makeContext();
      await executeAgentNode(
        makeNode({ sessionTarget: "isolated", prompt: "hello world" }),
        {},
        ctx,
      );

      const callArgs = (ctx.runIsolatedAgentJob as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.message).toBe("hello world");
    });

    it("string input is prepended to prompt", async () => {
      const ctx = makeContext();
      await executeAgentNode(
        makeNode({ sessionTarget: "isolated", prompt: "process this" }),
        "raw text data",
        ctx,
      );

      const callArgs = (ctx.runIsolatedAgentJob as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.message).toContain("raw text data");
      expect(callArgs.message).toContain("process this");
    });
  });
});

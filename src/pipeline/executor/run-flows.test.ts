// ---------------------------------------------------------------------------
// Pipeline DAG Executor – End-to-End Flow Tests
// ---------------------------------------------------------------------------
// Comprehensive tests exercising full pipeline execution through multiple node
// types, complex topologies, data flow, error propagation, and branching.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pipeline, PipelineEdge, PipelineNode, PipelineRun, NodeConfig } from "../types.js";
import type { RunEvent } from "./run.js";

// ---------------------------------------------------------------------------
// Mock all node executors BEFORE importing the module under test.
// ---------------------------------------------------------------------------

vi.mock("./agent.js", () => ({
  executeAgentNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { result: "agent done" },
    durationMs: 100,
  }),
}));

vi.mock("./app.js", () => ({
  executeAppNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { result: "app done" },
    durationMs: 200,
  }),
}));

vi.mock("./approval.js", () => ({
  executeApprovalNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { approved: true, taskId: "t-1" },
    outputHandle: "approved",
    durationMs: 50,
  }),
}));

vi.mock("./code.js", () => ({
  executeCodeNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { codeResult: 42 },
    durationMs: 150,
  }),
}));

vi.mock("./condition.js", () => ({
  executeConditionNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { matched: true },
    outputHandle: "true",
    durationMs: 10,
  }),
}));

vi.mock("./loop.js", () => ({
  executeLoopNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { iterations: 3, lastOutput: { done: true } },
    outputHandle: "done",
    durationMs: 300,
  }),
}));

vi.mock("./action.js", () => ({
  executeNotifyNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { notified: true },
    durationMs: 20,
  }),
}));

import type { ExecutorContext } from "./types.js";
import { executeNotifyNode } from "./action.js";
import { executeAgentNode } from "./agent.js";
import { executeAppNode } from "./app.js";
import { executeApprovalNode } from "./approval.js";
import { executeCodeNode } from "./code.js";
import { executeConditionNode } from "./condition.js";
import { executeLoopNode } from "./loop.js";
import { executePipeline } from "./run.js";

const mockAgent = vi.mocked(executeAgentNode);
const mockApp = vi.mocked(executeAppNode);
const mockApproval = vi.mocked(executeApprovalNode);
const mockCode = vi.mocked(executeCodeNode);
const mockCondition = vi.mocked(executeConditionNode);
const mockLoop = vi.mocked(executeLoopNode);
const mockNotify = vi.mocked(executeNotifyNode);

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

const DEFAULT_STATE = { status: "idle" as const, retryCount: 0 };
const POS = { x: 0, y: 0 };

function node(id: string, type: string, config?: Partial<NodeConfig>): PipelineNode {
  return {
    id,
    type,
    label: id,
    config: { ...config } as NodeConfig,
    position: POS,
    state: { ...DEFAULT_STATE },
  };
}

function edge(
  source: string,
  target: string,
  opts?: { sourceHandle?: string; targetHandle?: string },
): PipelineEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: opts?.sourceHandle,
    targetHandle: opts?.targetHandle,
  };
}

function pipeline(nodes: PipelineNode[], edges: PipelineEdge[], id = "pipe-1"): Pipeline {
  return {
    id,
    name: "Test Pipeline",
    description: "",
    enabled: true,
    status: "active",
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    runCount: 0,
  };
}

function run(pipelineId = "pipe-1"): PipelineRun {
  return {
    id: "run-1",
    pipelineId,
    status: "running",
    trigger: "manual",
    nodeResults: [],
    startedAtMs: Date.now(),
  };
}

function ctx(): ExecutorContext {
  return { log: { info: vi.fn(), error: vi.fn() } };
}

function collect(): { onEvent: (e: RunEvent) => void; events: RunEvent[] } {
  const events: RunEvent[] = [];
  return { onEvent: (e) => events.push(e), events };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  mockAgent.mockResolvedValue({
    status: "success",
    output: { result: "agent done" },
    durationMs: 100,
  });
  mockApp.mockResolvedValue({ status: "success", output: { result: "app done" }, durationMs: 200 });
  mockApproval.mockResolvedValue({
    status: "success",
    output: { approved: true, taskId: "t-1" },
    outputHandle: "approved",
    durationMs: 50,
  });
  mockCode.mockResolvedValue({ status: "success", output: { codeResult: 42 }, durationMs: 150 });
  mockCondition.mockResolvedValue({
    status: "success",
    output: { matched: true },
    outputHandle: "true",
    durationMs: 10,
  });
  mockLoop.mockResolvedValue({
    status: "success",
    output: { iterations: 3, lastOutput: { done: true } },
    outputHandle: "done",
    durationMs: 300,
  });
  mockNotify.mockResolvedValue({ status: "success", output: { notified: true }, durationMs: 20 });
});

// ===========================================================================
// FLOW 1: trigger → code → agent → notify (linear with new node types)
// ===========================================================================

describe("Flow: trigger → code → agent → notify", () => {
  const nodes = [
    node("t", "manual"),
    node("c", "code", { description: "parse CSV" }),
    node("a", "agent", { prompt: "analyze data" }),
    node("n", "notify", { channels: ["slack"], message: "Done: {{input}}" }),
  ];
  const edges = [edge("t", "c"), edge("c", "a"), edge("a", "n")];

  it("executes all processing nodes in order", async () => {
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(result.nodeResults).toHaveLength(3);
    expect(result.nodeResults.map((r) => r.nodeId)).toEqual(["c", "a", "n"]);

    expect(mockCode).toHaveBeenCalledTimes(1);
    expect(mockAgent).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it("passes code output as input to agent node", async () => {
    const codeOutput = { parsed: [1, 2, 3] };
    mockCode.mockResolvedValueOnce({ status: "success", output: codeOutput, durationMs: 50 });

    const p = pipeline(nodes, edges);
    const { onEvent } = collect();
    await executePipeline(p, run(), ctx(), onEvent);

    const agentInput = mockAgent.mock.calls[0][1];
    expect(agentInput).toEqual(codeOutput);
  });

  it("passes agent output as input to notify node", async () => {
    const agentOutput = { analysis: "complete", score: 95 };
    mockAgent.mockResolvedValueOnce({ status: "success", output: agentOutput, durationMs: 50 });

    const p = pipeline(nodes, edges);
    const { onEvent } = collect();
    await executePipeline(p, run(), ctx(), onEvent);

    const notifyInput = mockNotify.mock.calls[0][1];
    expect(notifyInput).toEqual(agentOutput);
  });

  it("emits correct event sequence", async () => {
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();
    await executePipeline(p, run(), ctx(), onEvent);

    const types = events.map((e) => `${e.type}${e.nodeId ? `:${e.nodeId}` : ""}`);
    expect(types).toEqual([
      "node_started:c",
      "node_completed:c",
      "node_started:a",
      "node_completed:a",
      "node_started:n",
      "node_completed:n",
      "run_completed",
    ]);
  });
});

// ===========================================================================
// FLOW 2: trigger → agent → condition → (Healthy: notify, Unhealthy: notify)
// ===========================================================================

describe("Flow: trigger → agent → condition → branches", () => {
  const nodes = [
    node("t", "cron"),
    node("a", "agent", { prompt: "check status" }),
    node("cond", "condition", {
      question: "Is the system healthy?",
      options: ["Healthy", "Unhealthy"],
    }),
    node("yes", "notify", { channels: ["discord"], message: "All good" }),
    node("no", "notify", { channels: ["slack"], message: "Alert" }),
  ];
  const edges = [
    edge("t", "a"),
    edge("a", "cond"),
    edge("cond", "yes", { sourceHandle: "Healthy" }),
    edge("cond", "no", { sourceHandle: "Unhealthy" }),
  ];

  it("condition Healthy → yes-notify executes, no-notify skipped", async () => {
    mockCondition.mockResolvedValueOnce({
      status: "success",
      output: { question: "Is the system healthy?", chosen: "Healthy" },
      outputHandle: "Healthy",
      durationMs: 5,
    });

    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();
    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(mockNotify).toHaveBeenCalledTimes(1);

    const skipped = events.filter((e) => e.type === "node_skipped");
    expect(skipped.map((e) => e.nodeId)).toContain("no");
  });

  it("condition Unhealthy → no-notify executes, yes-notify skipped", async () => {
    mockCondition.mockResolvedValueOnce({
      status: "success",
      output: { question: "Is the system healthy?", chosen: "Unhealthy" },
      outputHandle: "Unhealthy",
      durationMs: 5,
    });

    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();
    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(mockNotify).toHaveBeenCalledTimes(1);

    const skipped = events.filter((e) => e.type === "node_skipped");
    expect(skipped.map((e) => e.nodeId)).toContain("yes");
  });
});

// ===========================================================================
// FLOW 3: trigger → approval → (approved: agent → notify, denied: notify)
// ===========================================================================

describe("Flow: trigger → approval gate → branches", () => {
  const nodes = [
    node("t", "manual"),
    node("gate", "approval", { message: "Deploy to prod?" }),
    node("deploy", "agent", { prompt: "deploy" }),
    node("done", "notify", { channels: ["slack"], message: "Deployed" }),
    node("abort", "notify", { channels: ["slack"], message: "Deployment denied" }),
  ];
  const edges = [
    edge("t", "gate"),
    edge("gate", "deploy", { sourceHandle: "approved" }),
    edge("deploy", "done"),
    edge("gate", "abort", { sourceHandle: "denied" }),
  ];

  it("approved → agent + done-notify execute, abort skipped", async () => {
    mockApproval.mockResolvedValueOnce({
      status: "success",
      output: { approved: true },
      outputHandle: "approved",
      durationMs: 10,
    });

    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();
    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(mockAgent).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);

    const skipped = events.filter((e) => e.type === "node_skipped");
    expect(skipped.map((e) => e.nodeId)).toContain("abort");
  });

  it("denied → abort-notify executes, agent + done-notify skipped", async () => {
    mockApproval.mockResolvedValueOnce({
      status: "success",
      output: { approved: false },
      outputHandle: "denied",
      durationMs: 10,
    });

    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();
    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockAgent).not.toHaveBeenCalled();

    const skippedIds = events.filter((e) => e.type === "node_skipped").map((e) => e.nodeId);
    expect(skippedIds).toContain("deploy");
    expect(skippedIds).toContain("done");
  });
});

// ===========================================================================
// FLOW 4: trigger → loop → notify
// ===========================================================================

describe("Flow: trigger → loop → notify", () => {
  it("loop output is passed as input to downstream notify node", async () => {
    const loopOutput = { iterations: 5, lastOutput: { data: "final" } };
    mockLoop.mockResolvedValueOnce({
      status: "success",
      output: loopOutput,
      outputHandle: "done",
      durationMs: 100,
    });

    const nodes = [
      node("t", "manual"),
      node("lp", "loop", { maxIterations: 5, condition: "" }),
      node("n", "notify", { channels: ["slack"], message: "Loop done" }),
    ];
    // Loop's "done" handle connects to notify.
    const edges = [edge("t", "lp"), edge("lp", "n", { sourceHandle: "done" })];
    const p = pipeline(nodes, edges);
    const { onEvent } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(mockLoop).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);

    const notifyInput = mockNotify.mock.calls[0][1];
    expect(notifyInput).toEqual(loopOutput);
  });
});

// ===========================================================================
// FLOW 5: code node failure → downstream skipped
// ===========================================================================

describe("Flow: code failure cascades", () => {
  it("code failure skips all downstream nodes", async () => {
    mockCode.mockResolvedValueOnce({
      status: "failure",
      error: "Syntax error in generated code",
      durationMs: 50,
    });

    const nodes = [
      node("t", "manual"),
      node("c", "code", { description: "generate report" }),
      node("a", "agent", { prompt: "review" }),
      node("n", "notify", { channels: ["slack"], message: "done" }),
    ];
    const edges = [edge("t", "c"), edge("c", "a"), edge("a", "n")];
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("failed");

    // Code node failed.
    const codeFailed = events.find((e) => e.type === "node_failed" && e.nodeId === "c");
    expect(codeFailed).toBeDefined();
    expect(codeFailed!.error).toBe("Syntax error in generated code");

    // Downstream nodes skipped.
    expect(mockAgent).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();

    const skippedIds = events.filter((e) => e.type === "node_skipped").map((e) => e.nodeId);
    expect(skippedIds).toContain("a");
    expect(skippedIds).toContain("n");
  });
});

// ===========================================================================
// FLOW 6: complex diamond DAG — fan-out + fan-in
// ===========================================================================

describe("Flow: diamond DAG (fan-out → fan-in)", () => {
  //   t → a1 ─┐
  //       a2 ─┤→ n
  //   t → a2 ─┘
  it("fan-out to two agents, fan-in to notify with merged inputs", async () => {
    const out1 = { branch: "alpha" };
    const out2 = { branch: "beta" };
    mockAgent
      .mockResolvedValueOnce({ status: "success", output: out1, durationMs: 50 })
      .mockResolvedValueOnce({ status: "success", output: out2, durationMs: 50 });

    const nodes = [
      node("t", "manual"),
      node("a1", "agent", { prompt: "task A" }),
      node("a2", "agent", { prompt: "task B" }),
      node("n", "notify", { channels: ["slack"], message: "Done" }),
    ];
    const edges = [edge("t", "a1"), edge("t", "a2"), edge("a1", "n"), edge("a2", "n")];
    const p = pipeline(nodes, edges);
    const { onEvent } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(mockAgent).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenCalledTimes(1);

    // Notify should receive merged input from both agents.
    const notifyInput = mockNotify.mock.calls[0][1] as Record<string, unknown>;
    expect(notifyInput).toEqual({ a1: out1, a2: out2 });
  });

  it("if one fan-out branch fails, the fan-in node is skipped", async () => {
    mockAgent
      .mockResolvedValueOnce({ status: "success", output: { ok: true }, durationMs: 50 })
      .mockResolvedValueOnce({ status: "failure", error: "agent 2 crashed", durationMs: 50 });

    const nodes = [
      node("t", "manual"),
      node("a1", "agent", { prompt: "task A" }),
      node("a2", "agent", { prompt: "task B" }),
      node("n", "notify", { channels: ["slack"], message: "Done" }),
    ];
    const edges = [edge("t", "a1"), edge("t", "a2"), edge("a1", "n"), edge("a2", "n")];
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("failed");

    // Notify node should be skipped because a2 failed and n is downstream.
    const skipped = events.filter((e) => e.type === "node_skipped" && e.nodeId === "n");
    expect(skipped).toHaveLength(1);
  });
});

// ===========================================================================
// FLOW 7: trigger → agent (throws) → downstream skipped
// ===========================================================================

describe("Flow: executor exception handling", () => {
  it("executor throwing Error is caught, treated as failure, downstream skipped", async () => {
    mockAgent.mockRejectedValueOnce(new Error("OOM: out of memory"));

    const nodes = [
      node("t", "manual"),
      node("a", "agent", { prompt: "heavy task" }),
      node("n", "notify", { channels: ["slack"], message: "done" }),
    ];
    const edges = [edge("t", "a"), edge("a", "n")];
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("failed");
    const failed = events.find((e) => e.type === "node_failed" && e.nodeId === "a");
    expect(failed!.error).toBe("OOM: out of memory");
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("executor throwing non-Error is stringified", async () => {
    mockCode.mockRejectedValueOnce("string error");

    const nodes = [node("t", "manual"), node("c", "code", { description: "x" })];
    const edges = [edge("t", "c")];
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("failed");
    const failed = events.find((e) => e.type === "node_failed");
    expect(failed!.error).toBe("string error");
  });
});

// ===========================================================================
// FLOW 8: multi-trigger pipeline
// ===========================================================================

describe("Flow: multiple trigger nodes", () => {
  it("all triggers are silently skipped, processing nodes execute", async () => {
    const nodes = [node("t1", "cron"), node("t2", "webhook"), node("a", "agent", { prompt: "go" })];
    // Both triggers feed into the agent.
    const edges = [edge("t1", "a"), edge("t2", "a")];
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    // No trigger events.
    expect(events.filter((e) => e.nodeId === "t1" || e.nodeId === "t2")).toHaveLength(0);
    expect(mockAgent).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// FLOW 9: app node in a chain
// ===========================================================================

describe("Flow: trigger → app → agent → notify", () => {
  it("app output flows to agent then to notify", async () => {
    const appOutput = { screenshot: "base64...", url: "http://localhost:3000" };
    mockApp.mockResolvedValueOnce({ status: "success", output: appOutput, durationMs: 200 });

    const agentOutput = { analysis: "UI looks good" };
    mockAgent.mockResolvedValueOnce({ status: "success", output: agentOutput, durationMs: 100 });

    const nodes = [
      node("t", "manual"),
      node("app", "app", { appId: "my-app", prompt: "take screenshot" }),
      node("a", "agent", { prompt: "analyze screenshot" }),
      node("n", "notify", { channels: ["slack"], message: "Report" }),
    ];
    const edges = [edge("t", "app"), edge("app", "a"), edge("a", "n")];
    const p = pipeline(nodes, edges);
    const { onEvent } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(mockApp).toHaveBeenCalledTimes(1);

    // Agent received app output.
    expect(mockAgent.mock.calls[0][1]).toEqual(appOutput);
    // Notify received agent output.
    expect(mockNotify.mock.calls[0][1]).toEqual(agentOutput);
  });
});

// ===========================================================================
// FLOW 10: condition → condition (nested branching)
// ===========================================================================

describe("Flow: nested conditions", () => {
  it("chained conditions — second condition only runs on taken branch", async () => {
    // First condition → Yes → second condition → Low → notify
    mockCondition
      .mockResolvedValueOnce({
        status: "success",
        output: { question: "Process?", chosen: "Yes" },
        outputHandle: "Yes",
        durationMs: 5,
      })
      .mockResolvedValueOnce({
        status: "success",
        output: { question: "Priority?", chosen: "Low" },
        outputHandle: "Low",
        durationMs: 5,
      });

    const nodes = [
      node("t", "manual"),
      node("c1", "condition", { question: "Process?", options: ["Yes", "No"] }),
      node("c2", "condition", { question: "Priority?", options: ["High", "Low"] }),
      node("high", "agent", { prompt: "high" }), // c2 High branch
      node("low", "notify", { channels: ["slack"], message: "low" }), // c2 Low branch
      node("skip", "notify", { channels: ["slack"], message: "skipped" }), // c1 No branch
    ];
    const edges = [
      edge("t", "c1"),
      edge("c1", "c2", { sourceHandle: "Yes" }),
      edge("c1", "skip", { sourceHandle: "No" }),
      edge("c2", "high", { sourceHandle: "High" }),
      edge("c2", "low", { sourceHandle: "Low" }),
    ];
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");

    // c1 → Yes, so c2 executes. c2 → Low, so "low" executes.
    expect(mockCondition).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenCalledTimes(1); // "low" branch
    expect(mockAgent).not.toHaveBeenCalled(); // "high" skipped

    const skippedIds = events.filter((e) => e.type === "node_skipped").map((e) => e.nodeId);
    expect(skippedIds).toContain("skip");
    expect(skippedIds).toContain("high");
  });
});

// ===========================================================================
// FLOW 11: approval failure halts pipeline
// ===========================================================================

describe("Flow: approval node failure", () => {
  it("approval executor failure stops downstream", async () => {
    mockApproval.mockResolvedValueOnce({
      status: "failure",
      error: "Task creation failed",
      durationMs: 5,
    });

    const nodes = [
      node("t", "manual"),
      node("gate", "approval", { message: "approve?" }),
      node("a", "agent", { prompt: "deploy" }),
    ];
    const edges = [edge("t", "gate"), edge("gate", "a")];
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("failed");
    expect(mockAgent).not.toHaveBeenCalled();

    const failed = events.find((e) => e.type === "node_failed" && e.nodeId === "gate");
    expect(failed).toBeDefined();
    expect(failed!.error).toBe("Task creation failed");
  });
});

// ===========================================================================
// FLOW 12: empty pipeline
// ===========================================================================

describe("Flow: edge cases", () => {
  it("empty pipeline (no nodes) completes successfully", async () => {
    const p = pipeline([], []);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(result.nodeResults).toHaveLength(0);
    expect(events.at(-1)!.type).toBe("run_completed");
  });

  it("single processing node with no trigger completes", async () => {
    const p = pipeline([node("a", "agent", { prompt: "go" })], []);
    const { onEvent } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(mockAgent).toHaveBeenCalledTimes(1);
    // No upstream → input is undefined.
    expect(mockAgent.mock.calls[0][1]).toBeUndefined();
  });

  it("disconnected nodes all execute independently", async () => {
    const nodes = [
      node("a1", "agent", { prompt: "task 1" }),
      node("a2", "agent", { prompt: "task 2" }),
      node("n1", "notify", { channels: ["slack"], message: "hi" }),
    ];
    const p = pipeline(nodes, []); // No edges.
    const { onEvent } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(mockAgent).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// FLOW 13: all 4 trigger types are silently skipped
// ===========================================================================

describe("Flow: all trigger types are silently skipped", () => {
  it.each(["cron", "webhook", "task_event", "manual"] as const)(
    "%s trigger is silently skipped (no events emitted)",
    async (triggerType) => {
      const nodes = [node("t", triggerType), node("a", "agent", { prompt: "go" })];
      const edges = [edge("t", "a")];
      const p = pipeline(nodes, edges);
      const { onEvent, events } = collect();

      await executePipeline(p, run(), ctx(), onEvent);

      const triggerEvents = events.filter((e) => e.nodeId === "t");
      expect(triggerEvents).toHaveLength(0);
      expect(mockAgent).toHaveBeenCalledTimes(1);
    },
  );
});

// ===========================================================================
// FLOW 14: long chain — data propagates correctly through 5 nodes
// ===========================================================================

describe("Flow: long chain data propagation", () => {
  it("data flows correctly through 5 processing nodes", async () => {
    const outputs = [
      { step: 1, data: "raw" },
      { step: 2, data: "parsed" },
      { step: 3, data: "analyzed" },
      { step: 4, data: "formatted" },
    ];

    mockCode.mockResolvedValueOnce({ status: "success", output: outputs[0], durationMs: 10 });
    mockAgent
      .mockResolvedValueOnce({ status: "success", output: outputs[1], durationMs: 10 })
      .mockResolvedValueOnce({ status: "success", output: outputs[2], durationMs: 10 });
    mockNotify
      .mockResolvedValueOnce({ status: "success", output: outputs[3], durationMs: 10 })
      .mockResolvedValueOnce({ status: "success", output: { notified: true }, durationMs: 10 });

    const nodes = [
      node("t", "manual"),
      node("n1", "code", { description: "extract" }),
      node("n2", "agent", { prompt: "parse" }),
      node("n3", "agent", { prompt: "analyze" }),
      node("n4", "notify", { channels: ["slack"], message: "report" }),
      node("n5", "notify", { channels: ["slack"], message: "final" }),
    ];
    const edges = [
      edge("t", "n1"),
      edge("n1", "n2"),
      edge("n2", "n3"),
      edge("n3", "n4"),
      edge("n4", "n5"),
    ];
    const p = pipeline(nodes, edges);
    const { onEvent } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");
    expect(result.nodeResults).toHaveLength(5);

    // Verify each node got the correct input from the previous node.
    expect(mockCode.mock.calls[0][1]).toBeUndefined(); // First node, no upstream.
    expect(mockAgent.mock.calls[0][1]).toEqual(outputs[0]); // n2 gets n1's output.
    expect(mockAgent.mock.calls[1][1]).toEqual(outputs[1]); // n3 gets n2's output.
    expect(mockNotify.mock.calls[0][1]).toEqual(outputs[2]); // n4 gets n3's output.
    expect(mockNotify.mock.calls[1][1]).toEqual(outputs[3]); // n5 gets n4's output.
  });
});

// ===========================================================================
// FLOW 15: condition with deep downstream chains on both branches
// ===========================================================================

describe("Flow: condition with deep chains on both branches", () => {
  it("Proceed branch chain executes, Skip branch chain is fully skipped", async () => {
    mockCondition.mockResolvedValueOnce({
      status: "success",
      output: { question: "Continue?", chosen: "Proceed" },
      outputHandle: "Proceed",
      durationMs: 5,
    });

    const nodes = [
      node("t", "manual"),
      node("cond", "condition", { question: "Continue?", options: ["Proceed", "Skip"] }),
      // Proceed branch: a1 → a2 → n1
      node("a1", "agent", { prompt: "step 1" }),
      node("a2", "agent", { prompt: "step 2" }),
      node("n1", "notify", { channels: ["slack"], message: "done" }),
      // Skip branch: c1 → n2
      node("c1", "code", { description: "fallback" }),
      node("n2", "notify", { channels: ["slack"], message: "skipped" }),
    ];
    const edges = [
      edge("t", "cond"),
      edge("cond", "a1", { sourceHandle: "Proceed" }),
      edge("a1", "a2"),
      edge("a2", "n1"),
      edge("cond", "c1", { sourceHandle: "Skip" }),
      edge("c1", "n2"),
    ];
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("success");

    // Proceed branch executed.
    expect(mockAgent).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenCalledTimes(1);

    // Skip branch fully skipped.
    expect(mockCode).not.toHaveBeenCalled();

    const skippedIds = events.filter((e) => e.type === "node_skipped").map((e) => e.nodeId);
    expect(skippedIds).toContain("c1");
    expect(skippedIds).toContain("n2");
  });
});

// ===========================================================================
// FLOW 16: mid-chain failure skips only downstream, not parallel branches
// ===========================================================================

describe("Flow: failure isolation in parallel branches", () => {
  it("failure in one branch does not affect independent parallel branch", async () => {
    mockAgent
      .mockResolvedValueOnce({ status: "failure", error: "branch A failed", durationMs: 10 })
      .mockResolvedValueOnce({ status: "success", output: { ok: true }, durationMs: 10 });

    const nodes = [
      node("t", "manual"),
      node("a1", "agent", { prompt: "branch A" }),
      node("a2", "agent", { prompt: "branch B" }),
      node("n1", "notify", { channels: ["slack"], message: "A done" }), // downstream of a1
      node("n2", "notify", { channels: ["slack"], message: "B done" }), // downstream of a2
    ];
    const edges = [edge("t", "a1"), edge("t", "a2"), edge("a1", "n1"), edge("a2", "n2")];
    const p = pipeline(nodes, edges);
    const { onEvent, events } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    // Overall failed because a1 failed.
    expect(result.status).toBe("failed");

    // n1 should be skipped (downstream of failed a1).
    const skippedIds = events.filter((e) => e.type === "node_skipped").map((e) => e.nodeId);
    expect(skippedIds).toContain("n1");

    // a2 and n2 should still execute (independent branch).
    // Note: whether n2 executes depends on topological order. Both agents execute
    // because they're at the same level. But n2 is only downstream of a2.
    expect(mockNotify).toHaveBeenCalled();

    // At least one notify was called (n2). Check that n2 specifically ran.
    const n2Completed = events.find((e) => e.type === "node_completed" && e.nodeId === "n2");
    expect(n2Completed).toBeDefined();
  });
});

// ===========================================================================
// FLOW 17: run metadata — all results have correct structure
// ===========================================================================

describe("Flow: run result structure", () => {
  it("completed run has all required fields", async () => {
    const nodes = [
      node("t", "manual"),
      node("a", "agent", { prompt: "go" }),
      node("n", "notify", { channels: ["slack"], message: "done" }),
    ];
    const edges = [edge("t", "a"), edge("a", "n")];
    const p = pipeline(nodes, edges, "my-pipeline");
    const r = run("my-pipeline");
    const { onEvent } = collect();

    const result = await executePipeline(p, r, ctx(), onEvent);

    expect(result.id).toBe("run-1");
    expect(result.pipelineId).toBe("my-pipeline");
    expect(result.status).toBe("success");
    expect(result.completedAtMs).toBeDefined();
    expect(result.completedAtMs).toBeGreaterThanOrEqual(r.startedAtMs);
    expect(result.nodeResults).toHaveLength(2);

    for (const nr of result.nodeResults) {
      expect(nr.nodeId).toBeDefined();
      expect(nr.status).toBeDefined();
      expect(nr.startedAtMs).toBeDefined();
      expect(nr.completedAtMs).toBeDefined();
    }
  });

  it("failed run preserves all node results including the failed one", async () => {
    mockAgent.mockResolvedValueOnce({
      status: "failure",
      error: "timeout",
      output: { partial: "data" },
      durationMs: 50,
    });

    const nodes = [
      node("t", "manual"),
      node("a", "agent", { prompt: "go" }),
      node("n", "notify", { channels: ["slack"], message: "done" }),
    ];
    const edges = [edge("t", "a"), edge("a", "n")];
    const p = pipeline(nodes, edges);
    const { onEvent } = collect();

    const result = await executePipeline(p, run(), ctx(), onEvent);

    expect(result.status).toBe("failed");
    // Agent result + skipped notify result.
    expect(result.nodeResults).toHaveLength(2);

    const agentResult = result.nodeResults.find((r) => r.nodeId === "a");
    expect(agentResult!.status).toBe("failed");
    expect(agentResult!.error).toBe("timeout");

    const notifyResult = result.nodeResults.find((r) => r.nodeId === "n");
    expect(notifyResult!.status).toBe("skipped");
  });
});

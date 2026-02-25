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

vi.mock("./condition.js", () => ({
  executeConditionNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { matched: true },
    outputHandle: "true",
    durationMs: 10,
  }),
}));

vi.mock("./action.js", () => ({
  executeNotifyNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { notified: true },
    durationMs: 20,
  }),
  executeOutputNode: vi.fn().mockResolvedValue({
    status: "success",
    output: { formatted: "done" },
    durationMs: 5,
  }),
}));

import type { ExecutorContext } from "./types.js";
import { executeNotifyNode, executeOutputNode } from "./action.js";
import { executeAgentNode } from "./agent.js";
import { executeConditionNode } from "./condition.js";
import { executePipeline } from "./run.js";

const mockAgent = vi.mocked(executeAgentNode);
const mockCondition = vi.mocked(executeConditionNode);
const mockNotify = vi.mocked(executeNotifyNode);
const mockOutput = vi.mocked(executeOutputNode);

// ---------------------------------------------------------------------------
// Helpers — minimal node / edge / pipeline / run factories
// ---------------------------------------------------------------------------

const DEFAULT_STATE = { status: "idle" as const, retryCount: 0 };
const DEFAULT_POS = { x: 0, y: 0 };

function makeNode(id: string, type: string, config?: Partial<NodeConfig>): PipelineNode {
  return {
    id,
    type,
    label: id,
    config: { ...config } as NodeConfig,
    position: DEFAULT_POS,
    state: { ...DEFAULT_STATE },
  };
}

function makeEdge(
  source: string,
  target: string,
  opts?: { id?: string; sourceHandle?: string; targetHandle?: string },
): PipelineEdge {
  return {
    id: opts?.id ?? `${source}->${target}`,
    source,
    target,
    sourceHandle: opts?.sourceHandle,
    targetHandle: opts?.targetHandle,
  };
}

function makePipeline(
  nodes: PipelineNode[],
  edges: PipelineEdge[],
  overrides?: Partial<Pipeline>,
): Pipeline {
  return {
    id: "pipe-1",
    name: "Test Pipeline",
    description: "A test pipeline",
    enabled: true,
    status: "active",
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    runCount: 0,
    ...overrides,
  };
}

function makeRun(pipelineId = "pipe-1", overrides?: Partial<PipelineRun>): PipelineRun {
  return {
    id: "run-1",
    pipelineId,
    status: "running",
    trigger: "manual",
    nodeResults: [],
    startedAtMs: Date.now(),
    ...overrides,
  };
}

function makeContext(): ExecutorContext {
  return {
    log: { info: vi.fn(), error: vi.fn() },
  };
}

// ---------------------------------------------------------------------------
// Collect events helper
// ---------------------------------------------------------------------------

function collectEvents(): { onEvent: (e: RunEvent) => void; events: RunEvent[] } {
  const events: RunEvent[] = [];
  return { onEvent: (e: RunEvent) => events.push(e), events };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Reset default happy-path mocks.
  mockAgent.mockResolvedValue({
    status: "success",
    output: { result: "agent done" },
    durationMs: 100,
  });
  mockCondition.mockResolvedValue({
    status: "success",
    output: { matched: true },
    outputHandle: "true",
    durationMs: 10,
  });
  mockNotify.mockResolvedValue({
    status: "success",
    output: { notified: true },
    durationMs: 20,
  });
  mockOutput.mockResolvedValue({
    status: "success",
    output: { formatted: "done" },
    durationMs: 5,
  });
});

// ---------------------------------------------------------------------------
// Linear execution
// ---------------------------------------------------------------------------

describe("Linear execution", () => {
  it("executes a simple linear pipeline (trigger -> agent -> output)", async () => {
    const nodes = [makeNode("t1", "cron"), makeNode("a1", "agent"), makeNode("o1", "output")];
    const edges = [makeEdge("t1", "a1"), makeEdge("a1", "o1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    const result = await executePipeline(pipeline, run, makeContext(), onEvent);

    // Trigger is skipped (no executor call), agent and output are executed.
    expect(mockAgent).toHaveBeenCalledTimes(1);
    expect(mockOutput).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
    // Two node results: agent and output (trigger is silently skipped via continue).
    expect(result.nodeResults).toHaveLength(2);
    expect(result.nodeResults[0].nodeId).toBe("a1");
    expect(result.nodeResults[1].nodeId).toBe("o1");
  });

  it("passes upstream node output as input to downstream nodes", async () => {
    const agentOutput = { analysis: "complete" };
    mockAgent.mockResolvedValueOnce({
      status: "success",
      output: agentOutput,
      durationMs: 50,
    });

    const nodes = [makeNode("t1", "manual"), makeNode("a1", "agent"), makeNode("o1", "output")];
    const edges = [makeEdge("t1", "a1"), makeEdge("a1", "o1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    // The output node should receive the agent node's output as input.
    expect(mockOutput).toHaveBeenCalledTimes(1);
    const outputCallInput = mockOutput.mock.calls[0][1];
    expect(outputCallInput).toEqual(agentOutput);
  });

  it("returns completed run with 'success' status when all nodes succeed", async () => {
    const nodes = [makeNode("t1", "cron"), makeNode("a1", "agent"), makeNode("o1", "output")];
    const edges = [makeEdge("t1", "a1"), makeEdge("a1", "o1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent } = collectEvents();

    const result = await executePipeline(pipeline, run, makeContext(), onEvent);

    expect(result.status).toBe("success");
    expect(result.completedAtMs).toBeDefined();
    expect(result.nodeResults.every((r) => r.status === "success")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

describe("Event emission", () => {
  it("emits node_started then node_completed events for each executed node", async () => {
    const nodes = [makeNode("t1", "manual"), makeNode("a1", "agent"), makeNode("o1", "output")];
    const edges = [makeEdge("t1", "a1"), makeEdge("a1", "o1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    // For agent node: node_started then node_completed.
    const agentEvents = events.filter((e) => e.nodeId === "a1");
    expect(agentEvents[0].type).toBe("node_started");
    expect(agentEvents[1].type).toBe("node_completed");

    // For output node: node_started then node_completed.
    const outputEvents = events.filter((e) => e.nodeId === "o1");
    expect(outputEvents[0].type).toBe("node_started");
    expect(outputEvents[1].type).toBe("node_completed");
  });

  it("emits run_completed event at the end with 'success' status", async () => {
    const nodes = [makeNode("t1", "manual"), makeNode("a1", "agent")];
    const edges = [makeEdge("t1", "a1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    const runCompleted = events.find((e) => e.type === "run_completed");
    expect(runCompleted).toBeDefined();
    expect(runCompleted!.status).toBe("success");
    expect(runCompleted!.totalDurationMs).toBeDefined();
    // run_completed should be the last event.
    expect(events[events.length - 1].type).toBe("run_completed");
  });

  it("does not emit node_skipped for trigger nodes (triggers silently skipped)", async () => {
    const nodes = [makeNode("t1", "cron"), makeNode("a1", "agent")];
    const edges = [makeEdge("t1", "a1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    // Trigger nodes are skipped via `continue` — no node_skipped event emitted.
    const triggerSkipped = events.filter((e) => e.type === "node_skipped" && e.nodeId === "t1");
    expect(triggerSkipped).toHaveLength(0);
  });

  it("events include correct runId, pipelineId, nodeId, timestamps", async () => {
    const nodes = [makeNode("t1", "manual"), makeNode("a1", "agent")];
    const edges = [makeEdge("t1", "a1")];
    const pipeline = makePipeline(nodes, edges, { id: "my-pipe" });
    const run = makeRun("my-pipe", { id: "my-run" });
    const { onEvent, events } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    for (const event of events) {
      expect(event.runId).toBe("my-run");
      expect(event.pipelineId).toBe("my-pipe");
      expect(event.timestamp).toBeGreaterThan(0);
    }

    // Node-specific events should have nodeId set.
    const nodeEvents = events.filter((e) => e.type !== "run_completed");
    for (const event of nodeEvents) {
      expect(event.nodeId).toBe("a1");
    }
  });
});

// ---------------------------------------------------------------------------
// Node failure handling
// ---------------------------------------------------------------------------

describe("Node failure handling", () => {
  it("when a node fails, emits node_failed event", async () => {
    mockAgent.mockResolvedValueOnce({
      status: "failure",
      error: "Agent crashed",
      durationMs: 50,
    });

    const nodes = [makeNode("t1", "manual"), makeNode("a1", "agent")];
    const edges = [makeEdge("t1", "a1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    const failedEvent = events.find((e) => e.type === "node_failed" && e.nodeId === "a1");
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.error).toBe("Agent crashed");
  });

  it("when a node fails, all downstream nodes are skipped", async () => {
    mockAgent.mockResolvedValueOnce({
      status: "failure",
      error: "boom",
      durationMs: 10,
    });

    const nodes = [
      makeNode("t1", "manual"),
      makeNode("a1", "agent"),
      makeNode("n1", "notify"),
      makeNode("o1", "output"),
    ];
    const edges = [makeEdge("t1", "a1"), makeEdge("a1", "n1"), makeEdge("n1", "o1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    const result = await executePipeline(pipeline, run, makeContext(), onEvent);

    // Downstream nodes n1 and o1 should be skipped.
    const skippedEvents = events.filter((e) => e.type === "node_skipped");
    const skippedIds = skippedEvents.map((e) => e.nodeId).toSorted();
    expect(skippedIds).toEqual(["n1", "o1"]);

    // Notify and output executors should NOT have been called.
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockOutput).not.toHaveBeenCalled();
  });

  it("run completes with 'failed' status when any node fails", async () => {
    mockAgent.mockResolvedValueOnce({
      status: "failure",
      error: "fail",
      durationMs: 5,
    });

    const nodes = [makeNode("t1", "manual"), makeNode("a1", "agent")];
    const edges = [makeEdge("t1", "a1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    const result = await executePipeline(pipeline, run, makeContext(), onEvent);

    expect(result.status).toBe("failed");

    const runCompleted = events.find((e) => e.type === "run_completed");
    expect(runCompleted!.status).toBe("failed");
  });

  it("node executor throwing an error is caught and treated as failure", async () => {
    mockAgent.mockRejectedValueOnce(new Error("unexpected crash"));

    const nodes = [makeNode("t1", "manual"), makeNode("a1", "agent"), makeNode("o1", "output")];
    const edges = [makeEdge("t1", "a1"), makeEdge("a1", "o1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    const result = await executePipeline(pipeline, run, makeContext(), onEvent);

    expect(result.status).toBe("failed");

    const failedEvent = events.find((e) => e.type === "node_failed" && e.nodeId === "a1");
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.error).toBe("unexpected crash");

    // Downstream output should be skipped.
    const skippedEvent = events.find((e) => e.type === "node_skipped" && e.nodeId === "o1");
    expect(skippedEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Condition branching
// ---------------------------------------------------------------------------

describe("Condition branching", () => {
  it("condition node with outputHandle='true' — only true-branch downstream nodes execute", async () => {
    mockCondition.mockResolvedValueOnce({
      status: "success",
      output: { matched: true },
      outputHandle: "true",
      durationMs: 10,
    });

    const nodes = [
      makeNode("t1", "manual"),
      makeNode("c1", "condition"),
      makeNode("yes", "agent"), // true branch
      makeNode("no", "notify"), // false branch
    ];
    const edges = [
      makeEdge("t1", "c1"),
      makeEdge("c1", "yes", { sourceHandle: "true" }),
      makeEdge("c1", "no", { sourceHandle: "false" }),
    ];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    // True-branch node should execute.
    expect(mockAgent).toHaveBeenCalledTimes(1);
    // False-branch node should be skipped.
    expect(mockNotify).not.toHaveBeenCalled();

    const skippedEvent = events.find((e) => e.type === "node_skipped" && e.nodeId === "no");
    expect(skippedEvent).toBeDefined();
  });

  it("condition node with outputHandle='false' — true-branch nodes are skipped", async () => {
    mockCondition.mockResolvedValueOnce({
      status: "success",
      output: { matched: false },
      outputHandle: "false",
      durationMs: 10,
    });

    const nodes = [
      makeNode("t1", "manual"),
      makeNode("c1", "condition"),
      makeNode("yes", "agent"),
      makeNode("no", "notify"),
    ];
    const edges = [
      makeEdge("t1", "c1"),
      makeEdge("c1", "yes", { sourceHandle: "true" }),
      makeEdge("c1", "no", { sourceHandle: "false" }),
    ];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    // False-branch node should execute.
    expect(mockNotify).toHaveBeenCalledTimes(1);
    // True-branch node should be skipped.
    expect(mockAgent).not.toHaveBeenCalled();

    const skippedEvent = events.find((e) => e.type === "node_skipped" && e.nodeId === "yes");
    expect(skippedEvent).toBeDefined();
  });

  it("skipped branch nodes get node_skipped events with reason", async () => {
    mockCondition.mockResolvedValueOnce({
      status: "success",
      output: { matched: true },
      outputHandle: "true",
      durationMs: 10,
    });

    const nodes = [
      makeNode("t1", "manual"),
      makeNode("c1", "condition"),
      makeNode("yes", "agent"),
      makeNode("no", "notify"),
      makeNode("no2", "output"), // downstream of false branch
    ];
    const edges = [
      makeEdge("t1", "c1"),
      makeEdge("c1", "yes", { sourceHandle: "true" }),
      makeEdge("c1", "no", { sourceHandle: "false" }),
      makeEdge("no", "no2"),
    ];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    const skippedEvents = events.filter((e) => e.type === "node_skipped");
    expect(skippedEvents.length).toBeGreaterThanOrEqual(1);

    // All skipped events should have a reason.
    for (const ev of skippedEvents) {
      expect(ev.reason).toBeDefined();
      expect(typeof ev.reason).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Multiple upstream inputs
// ---------------------------------------------------------------------------

describe("Multiple upstream inputs", () => {
  it("node with 2+ upstream inputs receives merged object keyed by upstream node ID", async () => {
    const agentOutput1 = { data: "from-a1" };
    const agentOutput2 = { data: "from-a2" };

    mockAgent
      .mockResolvedValueOnce({ status: "success", output: agentOutput1, durationMs: 50 })
      .mockResolvedValueOnce({ status: "success", output: agentOutput2, durationMs: 50 });

    const nodes = [
      makeNode("t1", "manual"),
      makeNode("a1", "agent"),
      makeNode("a2", "agent"),
      makeNode("o1", "output"),
    ];
    const edges = [
      makeEdge("t1", "a1"),
      makeEdge("t1", "a2"),
      makeEdge("a1", "o1"),
      makeEdge("a2", "o1"),
    ];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    // Output node should receive a merged object { a1: ..., a2: ... }.
    expect(mockOutput).toHaveBeenCalledTimes(1);
    const outputInput = mockOutput.mock.calls[0][1];
    expect(outputInput).toEqual({
      a1: agentOutput1,
      a2: agentOutput2,
    });
  });

  it("node with single upstream gets that node's output directly (not wrapped)", async () => {
    const agentOutput = { message: "hello" };
    mockAgent.mockResolvedValueOnce({
      status: "success",
      output: agentOutput,
      durationMs: 50,
    });

    const nodes = [makeNode("t1", "manual"), makeNode("a1", "agent"), makeNode("o1", "output")];
    const edges = [makeEdge("t1", "a1"), makeEdge("a1", "o1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent } = collectEvents();

    await executePipeline(pipeline, run, makeContext(), onEvent);

    const outputInput = mockOutput.mock.calls[0][1];
    // Should be the raw output, not wrapped in { a1: ... }.
    expect(outputInput).toEqual(agentOutput);
  });
});

// ---------------------------------------------------------------------------
// DAG cycle detection
// ---------------------------------------------------------------------------

describe("DAG cycle detection", () => {
  it("cyclic pipeline returns failed run with DAG validation error", async () => {
    const nodes = [makeNode("a1", "agent"), makeNode("a2", "agent")];
    const edges = [makeEdge("a1", "a2"), makeEdge("a2", "a1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    const result = await executePipeline(pipeline, run, makeContext(), onEvent);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("DAG validation failed");
    expect(result.nodeResults).toHaveLength(0);
  });

  it("emits run_completed with 'failed' status and error message for cycles", async () => {
    const nodes = [makeNode("a1", "agent"), makeNode("a2", "agent"), makeNode("a3", "agent")];
    const edges = [makeEdge("a1", "a2"), makeEdge("a2", "a3"), makeEdge("a3", "a1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    const result = await executePipeline(pipeline, run, makeContext(), onEvent);

    const runCompleted = events.find((e) => e.type === "run_completed");
    expect(runCompleted).toBeDefined();
    expect(runCompleted!.status).toBe("failed");
    expect(runCompleted!.error).toContain("DAG validation failed");
    expect(result.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("pipeline with only trigger nodes — completes successfully with no executed nodes", async () => {
    const nodes = [makeNode("t1", "cron"), makeNode("t2", "webhook")];
    const edges = [makeEdge("t1", "t2")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    const result = await executePipeline(pipeline, run, makeContext(), onEvent);

    expect(result.status).toBe("success");
    // No node executors should have been called.
    expect(mockAgent).not.toHaveBeenCalled();
    expect(mockCondition).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockOutput).not.toHaveBeenCalled();

    // No nodeResults since triggers are silently skipped via continue.
    expect(result.nodeResults).toHaveLength(0);

    // Should still emit run_completed.
    const runCompleted = events.find((e) => e.type === "run_completed");
    expect(runCompleted).toBeDefined();
    expect(runCompleted!.status).toBe("success");
  });

  it("node type with no executor is skipped gracefully", async () => {
    const nodes = [
      makeNode("t1", "manual"),
      makeNode("x1", "unknown_custom_type"),
      makeNode("o1", "output"),
    ];
    const edges = [makeEdge("t1", "x1"), makeEdge("x1", "o1")];
    const pipeline = makePipeline(nodes, edges);
    const run = makeRun();
    const { onEvent, events } = collectEvents();

    const result = await executePipeline(pipeline, run, makeContext(), onEvent);

    // The unknown node should be skipped with a descriptive event.
    const skippedEvent = events.find((e) => e.type === "node_skipped" && e.nodeId === "x1");
    expect(skippedEvent).toBeDefined();
    expect(skippedEvent!.reason).toContain("No executor");
    expect(skippedEvent!.reason).toContain("unknown_custom_type");

    // Downstream output node should still execute (no-executor skip is not a failure).
    expect(mockOutput).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("success");
  });
});

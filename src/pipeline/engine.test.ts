import { describe, it, expect } from "vitest";
import type { PipelineNode, PipelineEdge, NodeConfig } from "./types.js";
import { PipelineEngine, PipelineCycleError } from "./engine.js";

// ---------------------------------------------------------------------------
// Helpers — minimal node / edge factories
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

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe("PipelineEngine.topologicalSort", () => {
  it("sorts a linear pipeline A → B → C", () => {
    const nodes = [makeNode("A", "cron"), makeNode("B", "agent"), makeNode("C", "output")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "C")];

    const sorted = PipelineEngine.topologicalSort(nodes, edges);
    const ids = sorted.map((n) => n.id);

    expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("B"));
    expect(ids.indexOf("B")).toBeLessThan(ids.indexOf("C"));
    expect(sorted).toHaveLength(3);
  });

  it("sorts a branching pipeline (A → B, A → C)", () => {
    const nodes = [makeNode("A", "webhook"), makeNode("B", "agent"), makeNode("C", "notify")];
    const edges = [makeEdge("A", "B"), makeEdge("A", "C")];

    const sorted = PipelineEngine.topologicalSort(nodes, edges);
    const ids = sorted.map((n) => n.id);

    expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("B"));
    expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("C"));
    expect(sorted).toHaveLength(3);
  });

  it("sorts a diamond pipeline (A → B, A → C, B → D, C → D)", () => {
    const nodes = [
      makeNode("A", "manual"),
      makeNode("B", "agent"),
      makeNode("C", "condition"),
      makeNode("D", "output"),
    ];
    const edges = [makeEdge("A", "B"), makeEdge("A", "C"), makeEdge("B", "D"), makeEdge("C", "D")];

    const sorted = PipelineEngine.topologicalSort(nodes, edges);
    const ids = sorted.map((n) => n.id);

    expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("B"));
    expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("C"));
    expect(ids.indexOf("B")).toBeLessThan(ids.indexOf("D"));
    expect(ids.indexOf("C")).toBeLessThan(ids.indexOf("D"));
    expect(sorted).toHaveLength(4);
  });

  it("returns a single node when there are no edges", () => {
    const nodes = [makeNode("X", "cron")];
    const sorted = PipelineEngine.topologicalSort(nodes, []);
    expect(sorted.map((n) => n.id)).toEqual(["X"]);
  });

  it("handles disconnected subgraphs", () => {
    const nodes = [
      makeNode("A", "cron"),
      makeNode("B", "agent"),
      makeNode("X", "webhook"),
      makeNode("Y", "notify"),
    ];
    const edges = [makeEdge("A", "B"), makeEdge("X", "Y")];

    const sorted = PipelineEngine.topologicalSort(nodes, edges);
    const ids = sorted.map((n) => n.id);

    expect(ids.indexOf("A")).toBeLessThan(ids.indexOf("B"));
    expect(ids.indexOf("X")).toBeLessThan(ids.indexOf("Y"));
    expect(sorted).toHaveLength(4);
  });

  it("throws PipelineCycleError for a simple cycle (A → B → A)", () => {
    const nodes = [makeNode("A", "agent"), makeNode("B", "agent")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "A")];

    expect(() => PipelineEngine.topologicalSort(nodes, edges)).toThrow(PipelineCycleError);
  });

  it("throws PipelineCycleError for a three-node cycle", () => {
    const nodes = [makeNode("A", "cron"), makeNode("B", "agent"), makeNode("C", "agent")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "C"), makeEdge("C", "A")];

    expect(() => PipelineEngine.topologicalSort(nodes, edges)).toThrow(PipelineCycleError);
  });

  it("ignores edges whose endpoints are not in the node set", () => {
    const nodes = [makeNode("A", "cron"), makeNode("B", "agent")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "GHOST")];

    // Should NOT throw — the dangling edge is silently skipped
    const sorted = PipelineEngine.topologicalSort(nodes, edges);
    expect(sorted.map((n) => n.id)).toEqual(["A", "B"]);
  });
});

// ---------------------------------------------------------------------------
// findTriggerNodes
// ---------------------------------------------------------------------------

describe("PipelineEngine.findTriggerNodes", () => {
  it("returns all trigger-type nodes", () => {
    const nodes = [
      makeNode("t1", "cron"),
      makeNode("t2", "webhook"),
      makeNode("t3", "task_event"),
      makeNode("t4", "manual"),
      makeNode("p1", "agent"),
      makeNode("a1", "output"),
    ];

    const triggers = PipelineEngine.findTriggerNodes(nodes);
    expect(triggers.map((n) => n.id).toSorted()).toEqual(["t1", "t2", "t3", "t4"]);
  });

  it("returns empty array when no triggers exist", () => {
    const nodes = [makeNode("p1", "agent"), makeNode("a1", "notify")];
    expect(PipelineEngine.findTriggerNodes(nodes)).toEqual([]);
  });

  it("does not match custom types that merely contain trigger names", () => {
    const nodes = [makeNode("x", "custom_cron_thing")];
    expect(PipelineEngine.findTriggerNodes(nodes)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getDownstreamNodes
// ---------------------------------------------------------------------------

describe("PipelineEngine.getDownstreamNodes", () => {
  const edges: PipelineEdge[] = [
    makeEdge("A", "B", { sourceHandle: "true" }),
    makeEdge("A", "C", { sourceHandle: "false" }),
    makeEdge("A", "D"),
    makeEdge("B", "D"),
  ];

  it("returns all downstream targets without sourceHandle filter", () => {
    const result = PipelineEngine.getDownstreamNodes("A", edges);
    expect(result.toSorted()).toEqual(["B", "C", "D"]);
  });

  it("filters by sourceHandle when provided", () => {
    const trueTargets = PipelineEngine.getDownstreamNodes("A", edges, "true");
    expect(trueTargets).toEqual(["B"]);

    const falseTargets = PipelineEngine.getDownstreamNodes("A", edges, "false");
    expect(falseTargets).toEqual(["C"]);
  });

  it("returns empty array for a node with no outgoing edges", () => {
    expect(PipelineEngine.getDownstreamNodes("D", edges)).toEqual([]);
  });

  it("returns edges with undefined sourceHandle when filtering by undefined", () => {
    // sourceHandle filter = undefined should match all (not just undefined handles)
    const result = PipelineEngine.getDownstreamNodes("A", edges, undefined);
    expect(result.toSorted()).toEqual(["B", "C", "D"]);
  });
});

// ---------------------------------------------------------------------------
// getUpstreamNodes
// ---------------------------------------------------------------------------

describe("PipelineEngine.getUpstreamNodes", () => {
  const edges: PipelineEdge[] = [makeEdge("A", "C"), makeEdge("B", "C"), makeEdge("C", "D")];

  it("returns all upstream sources", () => {
    const result = PipelineEngine.getUpstreamNodes("C", edges);
    expect(result.toSorted()).toEqual(["A", "B"]);
  });

  it("returns empty array for a root node", () => {
    expect(PipelineEngine.getUpstreamNodes("A", edges)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("PipelineEngine.validate", () => {
  it("returns valid for a well-formed pipeline", () => {
    const nodes = [makeNode("t", "cron"), makeNode("a", "agent"), makeNode("o", "output")];
    const edges = [makeEdge("t", "a"), makeEdge("a", "o")];

    const result = PipelineEngine.validate(nodes, edges);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("catches dangling edge with unknown source", () => {
    const nodes = [makeNode("A", "cron")];
    const edges = [makeEdge("GHOST", "A")];

    const result = PipelineEngine.validate(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('unknown source node "GHOST"')]),
    );
  });

  it("catches dangling edge with unknown target", () => {
    const nodes = [makeNode("A", "cron")];
    const edges = [makeEdge("A", "GHOST")];

    const result = PipelineEngine.validate(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('unknown target node "GHOST"')]),
    );
  });

  it("catches cycles", () => {
    const nodes = [makeNode("A", "cron"), makeNode("B", "agent"), makeNode("C", "agent")];
    const edges = [makeEdge("A", "B"), makeEdge("B", "C"), makeEdge("C", "B")];

    const result = PipelineEngine.validate(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("cycle")]));
  });

  it("catches missing trigger nodes", () => {
    const nodes = [makeNode("A", "agent"), makeNode("B", "output")];
    const edges = [makeEdge("A", "B")];

    const result = PipelineEngine.validate(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("at least one trigger node")]),
    );
  });

  it("accumulates multiple errors", () => {
    // No trigger, plus a dangling edge
    const nodes = [makeNode("A", "agent")];
    const edges = [makeEdge("A", "NOWHERE")];

    const result = PipelineEngine.validate(nodes, edges);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("validates an empty pipeline (no nodes)", () => {
    const result = PipelineEngine.validate([], []);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("at least one trigger node")]),
    );
  });
});

// ---------------------------------------------------------------------------
// Pipeline DAG Executor – Core Engine
// ---------------------------------------------------------------------------
// Provides topological sort (Kahn's algorithm), cycle detection, graph
// traversal helpers, and full pipeline validation.
// ---------------------------------------------------------------------------

import type { PipelineNode, PipelineEdge } from "./types.js";
import { VALID_TRIGGER_NODE_TYPES } from "./types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PipelineCycleError extends Error {
  constructor(message = "Pipeline contains a cycle") {
    super(message);
    this.name = "PipelineCycleError";
  }
}

// ---------------------------------------------------------------------------
// PipelineEngine
// ---------------------------------------------------------------------------

export class PipelineEngine {
  // -------------------------------------------------------------------------
  // topologicalSort – Kahn's algorithm
  // -------------------------------------------------------------------------
  /**
   * Return nodes in a valid execution order using Kahn's algorithm.
   * Throws `PipelineCycleError` if the graph contains a cycle.
   */
  static topologicalSort(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineNode[] {
    const nodeMap = new Map<string, PipelineNode>();
    for (const n of nodes) {
      nodeMap.set(n.id, n);
    }

    // Build in-degree map and adjacency list
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const n of nodes) {
      inDegree.set(n.id, 0);
      adjacency.set(n.id, []);
    }

    for (const e of edges) {
      // Only count edges whose endpoints both exist in the node set
      if (!nodeMap.has(e.source) || !nodeMap.has(e.target)) {
        continue;
      }
      adjacency.get(e.source)!.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    }

    // Seed the queue with zero-in-degree nodes
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    const sorted: PipelineNode[] = [];

    while (queue.length > 0) {
      const id = queue.shift()!;
      sorted.push(nodeMap.get(id)!);

      for (const neighbour of adjacency.get(id) ?? []) {
        const newDeg = (inDegree.get(neighbour) ?? 1) - 1;
        inDegree.set(neighbour, newDeg);
        if (newDeg === 0) {
          queue.push(neighbour);
        }
      }
    }

    if (sorted.length !== nodes.length) {
      throw new PipelineCycleError();
    }

    return sorted;
  }

  // -------------------------------------------------------------------------
  // findTriggerNodes
  // -------------------------------------------------------------------------
  /**
   * Return all nodes whose `type` is one of the recognised trigger types
   * (cron, webhook, task_event, manual).
   */
  static findTriggerNodes(nodes: PipelineNode[]): PipelineNode[] {
    return nodes.filter((n) => VALID_TRIGGER_NODE_TYPES.has(n.type));
  }

  // -------------------------------------------------------------------------
  // getDownstreamNodes
  // -------------------------------------------------------------------------
  /**
   * Return the IDs of nodes directly downstream of `nodeId`.
   * When `sourceHandle` is provided, only edges originating from that handle
   * are considered.
   */
  static getDownstreamNodes(
    nodeId: string,
    edges: PipelineEdge[],
    sourceHandle?: string,
  ): string[] {
    return edges
      .filter(
        (e) =>
          e.source === nodeId && (sourceHandle === undefined || e.sourceHandle === sourceHandle),
      )
      .map((e) => e.target);
  }

  // -------------------------------------------------------------------------
  // getUpstreamNodes
  // -------------------------------------------------------------------------
  /**
   * Return the IDs of nodes directly upstream of `nodeId`.
   */
  static getUpstreamNodes(nodeId: string, edges: PipelineEdge[]): string[] {
    return edges.filter((e) => e.target === nodeId).map((e) => e.source);
  }

  // -------------------------------------------------------------------------
  // validate
  // -------------------------------------------------------------------------
  /**
   * Run a battery of structural checks on the pipeline graph:
   *   1. Dangling edge references (source or target not in node set)
   *   2. Cycle detection
   *   3. At least one trigger node present
   *
   * Returns `{ valid, errors }`.
   */
  static validate(
    nodes: PipelineNode[],
    edges: PipelineEdge[],
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const nodeIds = new Set(nodes.map((n) => n.id));

    // 1. Dangling edges
    for (const e of edges) {
      if (!nodeIds.has(e.source)) {
        errors.push(`Edge "${e.id}" references unknown source node "${e.source}"`);
      }
      if (!nodeIds.has(e.target)) {
        errors.push(`Edge "${e.id}" references unknown target node "${e.target}"`);
      }
    }

    // 2. Cycle detection (only run if no dangling edges — topo sort needs
    //    consistent graph; dangling edges are already filtered in sort, but
    //    we still want to surface cycle errors when possible)
    try {
      PipelineEngine.topologicalSort(nodes, edges);
    } catch (err) {
      if (err instanceof PipelineCycleError) {
        errors.push("Pipeline contains a cycle");
      }
    }

    // 3. At least one trigger node
    const triggers = PipelineEngine.findTriggerNodes(nodes);
    if (triggers.length === 0) {
      errors.push("Pipeline must contain at least one trigger node");
    }

    return { valid: errors.length === 0, errors };
  }
}

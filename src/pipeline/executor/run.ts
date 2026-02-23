// ---------------------------------------------------------------------------
// Pipeline DAG Executor – Full Run Orchestrator
// ---------------------------------------------------------------------------
// Walks the pipeline DAG in topological order, executing each node with the
// appropriate executor and streaming events via `onEvent` callback.
// ---------------------------------------------------------------------------

import type {
  Pipeline,
  PipelineEdge,
  PipelineNode,
  PipelineRun,
  PipelineRunNodeResult,
} from "../types.js";
import type { ExecutorContext, NodeExecutionResult, NodeExecutorFn } from "./types.js";
import { PipelineEngine } from "../engine.js";
import { VALID_TRIGGER_NODE_TYPES } from "../types.js";
import { executeNotifyNode, executeOutputNode } from "./action.js";
import { executeAgentNode } from "./agent.js";
import { executeAppNode } from "./app.js";
import { executeApprovalNode } from "./approval.js";
import { executeCodeNode } from "./code.js";
import { executeConditionNode } from "./condition.js";
import { executeLoopNode } from "./loop.js";

// ---------------------------------------------------------------------------
// Run event types (mirrors frontend PipelineRunEvent)
// ---------------------------------------------------------------------------

export type RunEventType =
  | "node_started"
  | "node_completed"
  | "node_failed"
  | "node_skipped"
  | "agent_output"
  | "run_completed";

export interface RunEvent {
  type: RunEventType;
  runId: string;
  pipelineId: string;
  nodeId?: string;
  timestamp: number;
  output?: unknown;
  error?: string;
  reason?: string;
  text?: string;
  durationMs?: number;
  status?: string;
  totalDurationMs?: number;
  /** Gateway session key (for agent/code nodes that spawned a session). */
  sessionKey?: string;
}

export type RunEventCallback = (event: RunEvent) => void;

// ---------------------------------------------------------------------------
// Node type → executor mapping
// ---------------------------------------------------------------------------

const NODE_EXECUTORS: Record<string, NodeExecutorFn> = {
  agent: executeAgentNode,
  app: executeAppNode,
  approval: executeApprovalNode,
  code: executeCodeNode,
  condition: executeConditionNode,
  loop: executeLoopNode,
  notify: executeNotifyNode,
  output: executeOutputNode,
};

// ---------------------------------------------------------------------------
// executePipeline
// ---------------------------------------------------------------------------

/**
 * Execute a pipeline's DAG in topological order.
 *
 * - Trigger nodes are skipped (they define when to start, not what to do).
 * - Condition nodes drive branching via `outputHandle`.
 * - Events are emitted via `onEvent` for real-time streaming to the frontend.
 * - Returns the completed `PipelineRun` record.
 */
export async function executePipeline(
  pipeline: Pipeline,
  run: PipelineRun,
  context: ExecutorContext,
  onEvent: RunEventCallback,
): Promise<PipelineRun> {
  const startMs = Date.now();
  const nodeResults: PipelineRunNodeResult[] = [];

  // Map for quick node lookup.
  const nodeMap = new Map<string, PipelineNode>();
  for (const node of pipeline.nodes) {
    nodeMap.set(node.id, node);
  }

  // Output accumulator: nodeId → output (for passing to downstream nodes).
  const nodeOutputs = new Map<string, unknown>();

  // Track skipped nodes (e.g. nodes on the non-taken branch of a condition).
  const skippedNodes = new Set<string>();

  // Get execution order via topological sort.
  let sorted: PipelineNode[];
  try {
    sorted = PipelineEngine.topologicalSort(pipeline.nodes, pipeline.edges);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    onEvent({
      type: "run_completed",
      runId: run.id,
      pipelineId: pipeline.id,
      timestamp: Date.now(),
      status: "failed",
      error: `DAG validation failed: ${errorMsg}`,
      totalDurationMs: Date.now() - startMs,
    });
    return {
      ...run,
      status: "failed",
      error: `DAG validation failed: ${errorMsg}`,
      completedAtMs: Date.now(),
      nodeResults,
    };
  }

  // Walk nodes in topological order.
  for (const node of sorted) {
    // Skip trigger nodes — they define when to start, not what to do.
    if (VALID_TRIGGER_NODE_TYPES.has(node.type)) {
      continue;
    }

    // Skip nodes that were marked as skipped by condition branching.
    if (skippedNodes.has(node.id)) {
      const result: PipelineRunNodeResult = {
        nodeId: node.id,
        status: "skipped",
        startedAtMs: Date.now(),
        completedAtMs: Date.now(),
      };
      nodeResults.push(result);

      onEvent({
        type: "node_skipped",
        runId: run.id,
        pipelineId: pipeline.id,
        nodeId: node.id,
        timestamp: Date.now(),
        reason: "Condition branch not taken",
      });
      continue;
    }

    // Gather input from upstream nodes.
    const input = gatherUpstreamInput(node.id, pipeline.edges, nodeOutputs);

    // Find the executor for this node type.
    const executor = NODE_EXECUTORS[node.type];
    if (!executor) {
      // No executor for this node type — skip it.
      const result: PipelineRunNodeResult = {
        nodeId: node.id,
        status: "skipped",
        startedAtMs: Date.now(),
        completedAtMs: Date.now(),
      };
      nodeResults.push(result);

      onEvent({
        type: "node_skipped",
        runId: run.id,
        pipelineId: pipeline.id,
        nodeId: node.id,
        timestamp: Date.now(),
        reason: `No executor for node type "${node.type}"`,
      });
      continue;
    }

    // Emit node_started event.
    onEvent({
      type: "node_started",
      runId: run.id,
      pipelineId: pipeline.id,
      nodeId: node.id,
      timestamp: Date.now(),
    });

    // Execute the node.
    let execResult: NodeExecutionResult;
    try {
      execResult = await executor(node, input, context);
    } catch (err) {
      execResult = {
        status: "failure",
        error: err instanceof Error ? err.message : String(err),
        durationMs: 0,
      };
    }

    // Store the output for downstream nodes.
    if (execResult.output !== undefined) {
      nodeOutputs.set(node.id, execResult.output);
    }

    // Build node result.
    const nodeResult: PipelineRunNodeResult = {
      nodeId: node.id,
      status:
        execResult.status === "success"
          ? "success"
          : execResult.status === "skipped"
            ? "skipped"
            : "failed",
      startedAtMs: Date.now() - (execResult.durationMs ?? 0),
      completedAtMs: Date.now(),
      output: execResult.output,
      error: execResult.error,
    };
    nodeResults.push(nodeResult);

    // Emit completion/failure event.
    if (execResult.status === "success") {
      onEvent({
        type: "node_completed",
        runId: run.id,
        pipelineId: pipeline.id,
        nodeId: node.id,
        timestamp: Date.now(),
        output: execResult.output,
        durationMs: execResult.durationMs,
        sessionKey: execResult.sessionKey,
      });
    } else if (execResult.status === "failure") {
      onEvent({
        type: "node_failed",
        runId: run.id,
        pipelineId: pipeline.id,
        nodeId: node.id,
        timestamp: Date.now(),
        error: execResult.error ?? `Node "${node.label}" failed`,
        durationMs: execResult.durationMs,
      });

      // On failure, skip all downstream nodes.
      const downstreamIds = collectAllDownstream(node.id, pipeline.edges, nodeMap);
      for (const id of downstreamIds) {
        skippedNodes.add(id);
      }
    }

    // Handle branching: any node with an outputHandle (condition, approval, loop)
    // marks non-taken branches as skipped.
    if (execResult.outputHandle) {
      markSkippedBranches(node.id, execResult.outputHandle, pipeline.edges, nodeMap, skippedNodes);
    }
  }

  // Determine overall run status.
  const firstFailure = nodeResults.find((r) => r.status === "failed");
  const finalStatus = firstFailure ? "failed" : "success";
  const totalDurationMs = Date.now() - startMs;

  // Emit run_completed.
  onEvent({
    type: "run_completed",
    runId: run.id,
    pipelineId: pipeline.id,
    timestamp: Date.now(),
    status: finalStatus,
    error: firstFailure?.error,
    totalDurationMs,
  });

  return {
    ...run,
    status: finalStatus as PipelineRun["status"],
    nodeResults,
    completedAtMs: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Gather input for a node by merging outputs from all upstream nodes.
 * If a single upstream, pass its output directly. If multiple, merge into an
 * object keyed by upstream node ID.
 */
function gatherUpstreamInput(
  nodeId: string,
  edges: PipelineEdge[],
  nodeOutputs: Map<string, unknown>,
): unknown {
  const upstreamIds = PipelineEngine.getUpstreamNodes(nodeId, edges);

  if (upstreamIds.length === 0) {
    return undefined;
  }

  if (upstreamIds.length === 1) {
    return nodeOutputs.get(upstreamIds[0]);
  }

  // Multiple upstream nodes — merge into an object.
  const merged: Record<string, unknown> = {};
  for (const id of upstreamIds) {
    const output = nodeOutputs.get(id);
    if (output !== undefined) {
      merged[id] = output;
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * For a condition node, mark nodes on the non-taken branch as skipped.
 */
function markSkippedBranches(
  conditionNodeId: string,
  takenHandle: string,
  edges: PipelineEdge[],
  nodeMap: Map<string, PipelineNode>,
  skippedNodes: Set<string>,
): void {
  // Find edges from the condition node that DON'T match the taken handle.
  const skippedEdges = edges.filter(
    (e) => e.source === conditionNodeId && e.sourceHandle !== takenHandle,
  );

  for (const edge of skippedEdges) {
    const downstream = collectAllDownstream(edge.target, edges, nodeMap);
    downstream.add(edge.target);
    for (const id of downstream) {
      skippedNodes.add(id);
    }
  }
}

/**
 * Collect all transitively downstream node IDs from a given node.
 */
function collectAllDownstream(
  nodeId: string,
  edges: PipelineEdge[],
  nodeMap: Map<string, PipelineNode>,
): Set<string> {
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = PipelineEngine.getDownstreamNodes(current, edges);
    for (const child of children) {
      if (!visited.has(child) && nodeMap.has(child)) {
        visited.add(child);
        queue.push(child);
      }
    }
  }

  return visited;
}

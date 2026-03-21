// ---------------------------------------------------------------------------
// Pipeline Executor – Shared Types
// ---------------------------------------------------------------------------
// These types define the contract between the pipeline engine and individual
// node executors. Each executor receives a node, its accumulated input from
// upstream nodes, and a context bag with injectable dependencies.
// ---------------------------------------------------------------------------

import type { PipelineNode } from "../types.js";

// ---------------------------------------------------------------------------
// ExecutorContext — dependency bag passed to every executor
// ---------------------------------------------------------------------------

/** Resource limits for loop node execution. */
export type LoopResourceLimits = {
  /** Maximum iterations per loop node (default: 100). */
  maxIterations?: number;
  /** Maximum wall-clock time per loop node in milliseconds (default: 300_000 = 5 min). */
  maxExecutionTimeMs?: number;
  /** Maximum nested loop depth (default: 5). */
  maxNestedDepth?: number;
};

export type ExecutorContext = {
  /** Enqueue a system event into the main agent session. */
  enqueueSystemEvent?: (text: string, opts?: Record<string, unknown>) => void;
  /** Request an immediate heartbeat (agent wake). */
  requestHeartbeatNow?: (opts?: Record<string, unknown>) => void;
  /** Run an isolated agent turn outside the main session. */
  runIsolatedAgentJob?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Call a gateway RPC method. */
  callGatewayRpc?: (method: string, params: unknown) => Promise<unknown>;
  /** Optional structured logger. */
  log?: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  /** Resolve a workspace ID to its primary local mount path (auto-activates). */
  resolveWorkspaceDir?: (workspaceId: string) => Promise<string | null> | string | null;
  /** Resource limits for loop nodes. */
  loopResourceLimits?: LoopResourceLimits;
  /** Current loop nesting depth (tracked internally — do not set manually). */
  _loopDepth?: number;
};

// ---------------------------------------------------------------------------
// NodeExecutionResult — what every executor returns
// ---------------------------------------------------------------------------

export type NodeExecutionResult = {
  status: "success" | "failure" | "skipped";
  /** Arbitrary data produced by this node, passed downstream. */
  output?: unknown;
  /** Human-readable error message when status is "failure". */
  error?: string;
  /** Wall-clock duration of node execution. */
  durationMs?: number;
  /**
   * Which output port to follow for branching nodes (e.g. condition).
   * Edges whose `sourceHandle` matches this value are traversed.
   */
  outputHandle?: string;
  /** Gateway session key for agent/code nodes that spawned a session. */
  sessionKey?: string;
};

// ---------------------------------------------------------------------------
// NodeExecutorFn — signature for all node executors
// ---------------------------------------------------------------------------

export type NodeExecutorFn = (
  node: PipelineNode,
  input: unknown,
  context: ExecutorContext,
) => Promise<NodeExecutionResult>;

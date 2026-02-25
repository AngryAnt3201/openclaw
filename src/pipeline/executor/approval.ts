// ---------------------------------------------------------------------------
// Pipeline Executor – Approval Node
// ---------------------------------------------------------------------------
// Creates a task requiring human approval. Polls until approved, denied, or
// timed out. Returns outputHandle "approved" or "denied" for branching.
// ---------------------------------------------------------------------------

import type { ApprovalConfig, PipelineNode } from "../types.js";
import type { ExecutorContext, NodeExecutionResult, NodeExecutorFn } from "./types.js";

const DEFAULT_TIMEOUT_SEC = 3600; // 1 hour
const POLL_INTERVAL_MS = 2000;

export const executeApprovalNode: NodeExecutorFn = async (
  node: PipelineNode,
  input: unknown,
  context: ExecutorContext,
): Promise<NodeExecutionResult> => {
  const startMs = Date.now();
  const config = node.config as ApprovalConfig;

  if (!config.message) {
    return {
      status: "failure",
      error: "Approval node requires a message",
      durationMs: Date.now() - startMs,
    };
  }

  if (!context.callGatewayRpc) {
    return {
      status: "failure",
      error: "callGatewayRpc not available in executor context",
      durationMs: Date.now() - startMs,
    };
  }

  try {
    // Build approval message with upstream context if available.
    let message = config.message;
    if (input !== undefined && input !== null) {
      const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);
      if (inputStr && inputStr !== "{}" && inputStr !== "null") {
        message = `${config.message}\n\n[Context from previous step]\n${inputStr}`;
      }
    }

    // Create an approval task via the task system.
    const task = (await context.callGatewayRpc("task.create", {
      title: `Pipeline Approval: ${node.label}`,
      description: message,
      type: "approval",
      priority: "high",
      metadata: {
        pipelineNodeId: node.id,
        source: "pipeline",
      },
    })) as { id: string } | null;

    if (!task?.id) {
      return {
        status: "failure",
        error: "Failed to create approval task",
        durationMs: Date.now() - startMs,
      };
    }

    // Poll until the task is approved, rejected, or times out.
    const timeoutMs = (config.timeout ?? DEFAULT_TIMEOUT_SEC) * 1000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);

      const taskState = (await context.callGatewayRpc("task.get", {
        id: task.id,
      })) as { status?: string; resolution?: string } | null;

      if (!taskState) {
        continue;
      }

      // Check if task was approved or rejected.
      if (taskState.status === "completed") {
        const approved = taskState.resolution !== "rejected";
        return {
          status: "success",
          output: {
            approved,
            taskId: task.id,
            resolution: taskState.resolution,
          },
          outputHandle: approved ? "approved" : "denied",
          durationMs: Date.now() - startMs,
        };
      }

      // If the task was cancelled or failed, treat as denied.
      if (taskState.status === "cancelled" || taskState.status === "failed") {
        return {
          status: "success",
          output: {
            approved: false,
            taskId: task.id,
            resolution: taskState.status,
          },
          outputHandle: "denied",
          durationMs: Date.now() - startMs,
        };
      }
    }

    // Timed out — apply timeout action.
    const timeoutAction = config.timeoutAction ?? "deny";
    if (timeoutAction === "skip") {
      return {
        status: "skipped",
        output: { timedOut: true, taskId: task.id },
        durationMs: Date.now() - startMs,
      };
    }

    // Default: deny on timeout
    return {
      status: "success",
      output: {
        approved: false,
        taskId: task.id,
        timedOut: true,
      },
      outputHandle: "denied",
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    context.log?.error("Pipeline approval node failed:", err);
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Pipeline Executor – Agent Node
// ---------------------------------------------------------------------------
// Runs an agent turn, either within the main session (system event + heartbeat)
// or in an isolated session via runIsolatedAgentJob.
// ---------------------------------------------------------------------------

import type { AgentNodeConfig, PipelineNode } from "../types.js";
import type { ExecutorContext, NodeExecutionResult, NodeExecutorFn } from "./types.js";

// ---------------------------------------------------------------------------
// Default timeout for isolated agent jobs (5 minutes).
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_SEC = 300;

// ---------------------------------------------------------------------------
// executeAgentNode
// ---------------------------------------------------------------------------

export const executeAgentNode: NodeExecutorFn = async (
  node: PipelineNode,
  input: unknown,
  context: ExecutorContext,
): Promise<NodeExecutionResult> => {
  const startMs = Date.now();
  const config = node.config as AgentNodeConfig;

  if (!config.prompt) {
    return {
      status: "failure",
      error: "Agent node requires a prompt",
      durationMs: Date.now() - startMs,
    };
  }

  try {
    if (config.session === "main") {
      return await executeMainSession(config, input, context, startMs);
    }
    return await executeIsolatedSession(config, input, context, startMs);
  } catch (err) {
    context.log?.error("Pipeline agent node failed:", err);
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
};

// ---------------------------------------------------------------------------
// Main session path — enqueue system event + request heartbeat
// ---------------------------------------------------------------------------

async function executeMainSession(
  config: AgentNodeConfig,
  input: unknown,
  context: ExecutorContext,
  startMs: number,
): Promise<NodeExecutionResult> {
  if (!context.enqueueSystemEvent) {
    return {
      status: "failure",
      error: "enqueueSystemEvent not available in executor context",
      durationMs: Date.now() - startMs,
    };
  }

  // Build the prompt with upstream context when available.
  const prompt = buildPromptWithInput(config.prompt, input);

  context.enqueueSystemEvent(prompt, {});

  context.requestHeartbeatNow?.({ reason: "pipeline:agent" });

  return {
    status: "success",
    output: { dispatched: true, prompt, session: "main" },
    durationMs: Date.now() - startMs,
  };
}

// ---------------------------------------------------------------------------
// Isolated session path — run isolated agent job
// ---------------------------------------------------------------------------

async function executeIsolatedSession(
  config: AgentNodeConfig,
  input: unknown,
  context: ExecutorContext,
  startMs: number,
): Promise<NodeExecutionResult> {
  if (!context.runIsolatedAgentJob) {
    return {
      status: "failure",
      error: "runIsolatedAgentJob not available in executor context",
      durationMs: Date.now() - startMs,
    };
  }

  const timeoutSec = config.timeout ?? DEFAULT_TIMEOUT_SEC;

  const result = await context.runIsolatedAgentJob({
    message: buildPromptWithInput(config.prompt, input),
    model: config.model,
    tools: config.tools,
    credentials: config.credentials,
    apps: config.apps,
    thinking: config.thinking,
    timeoutSeconds: timeoutSec,
    previousOutput: input,
  });

  const isOk = result.status === "ok";
  const status = isOk ? "success" : "failure";

  // Extract error from multiple possible fields — gateway responses vary.
  const error = !isOk
    ? ((typeof result.error === "string" ? result.error : undefined) ??
      (typeof result.message === "string" ? result.message : undefined) ??
      `Agent returned status: ${String(result.status ?? "unknown")}`)
    : undefined;

  return {
    status,
    output: result,
    error,
    durationMs: Date.now() - startMs,
    sessionKey: typeof result.sessionKey === "string" ? result.sessionKey : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Prepend a summary of the upstream node's output to the prompt so the agent
 * has context about previous pipeline steps.
 */
function buildPromptWithInput(prompt: string, input: unknown): string {
  if (input === undefined || input === null) {
    return prompt;
  }

  const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);

  // Don't bloat the prompt if input is empty.
  if (!inputStr || inputStr === "{}" || inputStr === "null") {
    return prompt;
  }

  return `[Pipeline context — previous node output]\n${inputStr}\n\n${prompt}`;
}

// ---------------------------------------------------------------------------
// Pipeline Executor – Condition Node (LLM Router)
// ---------------------------------------------------------------------------
// Classifies upstream input against a set of named options using an LLM
// `route` tool with enum-constrained structured output. Returns the chosen
// option as `outputHandle` so the DAG engine follows the matching branch.
// ---------------------------------------------------------------------------

import type { ConditionConfig, PipelineNode } from "../types.js";
import type { NodeExecutionResult, NodeExecutorFn } from "./types.js";

// ---------------------------------------------------------------------------
// executeConditionNode
// ---------------------------------------------------------------------------

export const executeConditionNode: NodeExecutorFn = async (
  node: PipelineNode,
  input: unknown,
  context,
): Promise<NodeExecutionResult> => {
  const startMs = Date.now();
  const config = node.config as ConditionConfig;

  if (!config.question) {
    return {
      status: "failure",
      error: "Condition node requires a question",
      durationMs: Date.now() - startMs,
    };
  }

  if (!config.options || config.options.length < 2) {
    return {
      status: "failure",
      error: "Condition node requires at least 2 options",
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
    const result = (await context.callGatewayRpc("pipeline.classify", {
      question: config.question,
      options: config.options,
      input: summariseInput(input),
    })) as { option: string };

    const chosen = result.option;

    // Validate that the returned option is one we expect.
    if (!config.options.includes(chosen)) {
      return {
        status: "failure",
        error: `LLM returned unknown option "${chosen}" (expected one of: ${config.options.join(", ")})`,
        durationMs: Date.now() - startMs,
      };
    }

    return {
      status: "success",
      output: { question: config.question, chosen },
      outputHandle: chosen,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Produce a concise string summary of upstream input for the LLM prompt. */
function summariseInput(input: unknown): string {
  if (input === undefined || input === null) {
    return "(no input)";
  }
  if (typeof input === "string") {
    return input.slice(0, 2000);
  }
  const json = JSON.stringify(input, null, 2);
  return json.length > 2000 ? json.slice(0, 1997) + "..." : json;
}

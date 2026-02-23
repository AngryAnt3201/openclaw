// ---------------------------------------------------------------------------
// Pipeline Executor – Code Node
// ---------------------------------------------------------------------------
// Spawns an agent turn that writes and executes code in any language.
// The agent receives upstream data as variables and iterates until success.
// ---------------------------------------------------------------------------

import type { PipelineNode } from "../types.js";
import type { ExecutorContext, NodeExecutionResult, NodeExecutorFn } from "./types.js";

interface CodeNodeConfig {
  description: string;
  language?: string;
  maxRetries?: number;
  timeout?: number;
}

export const executeCodeNode: NodeExecutorFn = async (
  node: PipelineNode,
  input: unknown,
  context: ExecutorContext,
): Promise<NodeExecutionResult> => {
  const startMs = Date.now();
  const config = node.config as CodeNodeConfig;

  if (!config.description) {
    return {
      status: "failure",
      error: "Code node requires a description of what the code should do",
      durationMs: Date.now() - startMs,
    };
  }

  if (!context.runIsolatedAgentJob) {
    return {
      status: "failure",
      error: "runIsolatedAgentJob not available in executor context",
      durationMs: Date.now() - startMs,
    };
  }

  try {
    const parts: string[] = [];

    if (input !== undefined && input !== null) {
      const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);
      parts.push(`[Pipeline variables — data from previous nodes]\n${inputStr}`);
    }

    parts.push(
      `[Task]\nWrite and execute code to accomplish the following:\n${config.description}`,
    );

    if (config.language && config.language !== "auto") {
      parts.push(`\nPreferred language: ${config.language}`);
    }

    parts.push(
      `\nYou have access to the execute_code tool. Use it to write and run code.`,
      `Pass any pipeline variables from above into your code as needed.`,
      `If execution fails, read the error and retry (up to ${config.maxRetries ?? 3} attempts).`,
      `Return your final result as the tool output.`,
    );

    const prompt = parts.join("\n\n");

    const result = await context.runIsolatedAgentJob({
      message: prompt,
      tools: ["execute_code"],
      timeoutSeconds: config.timeout ?? 120,
    });

    const status = (result as Record<string, unknown>).status;

    if (status === "ok") {
      return {
        status: "success",
        output: (result as Record<string, unknown>).summary ?? result,
        durationMs: Date.now() - startMs,
      };
    }

    return {
      status: "failure",
      error: ((result as Record<string, unknown>).error as string) ?? "Code execution failed",
      output: (result as Record<string, unknown>).summary,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    context.log?.error("Pipeline code node failed:", err);
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
};

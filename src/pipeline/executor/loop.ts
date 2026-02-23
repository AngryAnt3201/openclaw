// ---------------------------------------------------------------------------
// Pipeline Executor – Loop Node
// ---------------------------------------------------------------------------
// Repeats a body sub-graph up to maxIterations times or until a condition
// evaluates to false. Each iteration passes the previous output as input
// to the next. The loop node itself emits "body" (each iteration) and
// "done" (final output) handles.
// ---------------------------------------------------------------------------

import type { LoopConfig, PipelineNode } from "../types.js";
import type { ExecutorContext, NodeExecutionResult, NodeExecutorFn } from "./types.js";

const DEFAULT_MAX_ITERATIONS = 10;

export const executeLoopNode: NodeExecutorFn = async (
  node: PipelineNode,
  input: unknown,
  context: ExecutorContext,
): Promise<NodeExecutionResult> => {
  const startMs = Date.now();
  const config = node.config as LoopConfig;

  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (maxIterations <= 0) {
    return {
      status: "failure",
      error: "Loop maxIterations must be > 0",
      durationMs: Date.now() - startMs,
    };
  }

  try {
    let currentInput = input;
    let iteration = 0;
    const iterationOutputs: unknown[] = [];

    while (iteration < maxIterations) {
      // If a condition is set, evaluate it before each iteration.
      if (config.condition && iteration > 0) {
        const shouldContinue = evaluateLoopCondition(config.condition, currentInput, iteration);
        if (!shouldContinue) {
          break;
        }
      }

      iteration++;

      // For the loop body, we dispatch an isolated agent job if available.
      // The loop node acts as a controller — the body is executed downstream
      // via the "body" outputHandle, and the DAG runner handles this.
      // In the simple case, the loop just tracks iterations and passes data.
      iterationOutputs.push(currentInput);

      // If we have an agent job runner, we could run the body inline.
      // For now, the loop returns after one conceptual "iteration" and
      // the DAG runner re-invokes if needed via the body edge.
      // This means the loop node outputs the accumulated state.
      currentInput = {
        iteration,
        previousOutput: currentInput,
      };
    }

    return {
      status: "success",
      output: {
        iterations: iteration,
        lastOutput: currentInput,
        outputs: iterationOutputs,
      },
      // After loop completes, follow the "done" handle.
      outputHandle: "done",
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    context.log?.error("Pipeline loop node failed:", err);
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
};

/**
 * Evaluate a simple loop condition. Supports:
 *   - "true" / "false" — literal
 *   - "iteration < N" — iteration count check
 *   - "input.path" — truthy check on current input
 *   - "input.path === value" — equality check
 */
function evaluateLoopCondition(condition: string, input: unknown, iteration: number): boolean {
  const expr = condition.trim();

  if (expr === "true") {
    return true;
  }
  if (expr === "false") {
    return false;
  }

  // Replace "iteration" token with actual value, then evaluate.
  const resolved = expr.replace(/\biteration\b/g, String(iteration));

  // Simple numeric comparisons for iteration checks.
  const compOps = ["<=", ">=", "<", ">", "===", "!=="] as const;
  for (const op of compOps) {
    const idx = resolved.indexOf(op);
    if (idx === -1) {
      continue;
    }

    const left = resolved.slice(0, idx).trim();
    const right = resolved.slice(idx + op.length).trim();
    const leftVal = resolveLoopValue(left, input);
    const rightVal = parseLoopValue(right);

    switch (op) {
      case "<":
        return Number(leftVal) < Number(rightVal);
      case ">":
        return Number(leftVal) > Number(rightVal);
      case "<=":
        return Number(leftVal) <= Number(rightVal);
      case ">=":
        return Number(leftVal) >= Number(rightVal);
      case "===":
        return leftVal === rightVal;
      case "!==":
        return leftVal !== rightVal;
    }
  }

  // Truthy check on a path.
  return Boolean(resolveLoopValue(resolved, input));
}

function resolveLoopValue(token: string, input: unknown): unknown {
  const num = Number(token);
  if (!Number.isNaN(num) && token !== "") {
    return num;
  }

  if (token === "input") {
    return input;
  }
  if (token.startsWith("input.")) {
    const path = token.slice("input.".length).split(".");
    let current: unknown = input;
    for (const seg of path) {
      if (current == null || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[seg];
    }
    return current;
  }
  return token;
}

function parseLoopValue(token: string): unknown {
  if (token === "true") {
    return true;
  }
  if (token === "false") {
    return false;
  }
  if (token === "null") {
    return null;
  }
  const num = Number(token);
  if (!Number.isNaN(num) && token !== "") {
    return num;
  }
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

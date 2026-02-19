// ---------------------------------------------------------------------------
// Pipeline Executor – Condition Node
// ---------------------------------------------------------------------------
// Evaluates a simple expression and returns an outputHandle of "true" or
// "false" to drive downstream edge selection. Deliberately avoids eval() in
// favour of a small safe expression evaluator.
// ---------------------------------------------------------------------------

import type { ConditionConfig, PipelineNode } from "../types.js";
import type { NodeExecutionResult, NodeExecutorFn } from "./types.js";

// ---------------------------------------------------------------------------
// executeConditionNode
// ---------------------------------------------------------------------------

export const executeConditionNode: NodeExecutorFn = async (
  node: PipelineNode,
  input: unknown,
  _context,
): Promise<NodeExecutionResult> => {
  const startMs = Date.now();
  const config = node.config as ConditionConfig;

  if (!config.expression) {
    return {
      status: "failure",
      error: "Condition node requires an expression",
      durationMs: Date.now() - startMs,
    };
  }

  try {
    const result = evaluateExpression(config.expression, input);
    const boolResult = Boolean(result);

    return {
      status: "success",
      output: { expression: config.expression, result: boolResult },
      outputHandle: boolResult ? "true" : "false",
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
// Safe expression evaluator (no eval / Function constructor)
// ---------------------------------------------------------------------------

/**
 * Evaluate a simple expression string against the `input` value.
 *
 * Supported expression forms:
 *   - `"true"` / `"false"` — boolean literal
 *   - `"input"` — truthy check on the entire input
 *   - `"input.some.path"` — resolve a dot-path on input
 *   - `"input.some.path === value"` — equality comparison
 *   - `"input.some.path !== value"` — inequality comparison
 *   - `"input.some.path > value"` — numeric greater-than
 *   - `"input.some.path < value"` — numeric less-than
 *   - `"input.some.path >= value"` — numeric greater-or-equal
 *   - `"input.some.path <= value"` — numeric less-or-equal
 */
function evaluateExpression(expression: string, input: unknown): unknown {
  const expr = expression.trim();

  // Literal booleans
  if (expr === "true") {
    return true;
  }
  if (expr === "false") {
    return false;
  }

  // Comparison operators (order matters — check multi-char ops first)
  const comparisonOps = ["!==", "===", ">=", "<=", ">", "<"] as const;

  for (const op of comparisonOps) {
    const idx = expr.indexOf(op);
    if (idx === -1) {
      continue;
    }

    const left = expr.slice(0, idx).trim();
    const right = expr.slice(idx + op.length).trim();
    const leftValue = resolveValue(left, input);
    const rightValue = parseValue(right);

    switch (op) {
      case "===":
        return leftValue === rightValue;
      case "!==":
        return leftValue !== rightValue;
      case ">":
        return Number(leftValue) > Number(rightValue);
      case "<":
        return Number(leftValue) < Number(rightValue);
      case ">=":
        return Number(leftValue) >= Number(rightValue);
      case "<=":
        return Number(leftValue) <= Number(rightValue);
    }
  }

  // Simple path or literal — resolve and return truthiness
  return resolveValue(expr, input);
}

/**
 * Resolve a value reference. If it starts with "input." or is "input",
 * walk the JSON path on the input object. Otherwise treat as literal.
 */
function resolveValue(token: string, input: unknown): unknown {
  if (token === "input") {
    return input;
  }
  if (token.startsWith("input.")) {
    return resolvePath(input, token.slice("input.".length));
  }
  return parseValue(token);
}

/**
 * Walk a dot-separated path into an object. Returns `undefined` for
 * missing segments.
 */
function resolvePath(obj: unknown, dotPath: string): unknown {
  const segments = dotPath.split(".");
  let current: unknown = obj;

  for (const seg of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }

  return current;
}

/**
 * Parse a literal value from a string: numbers, booleans, quoted strings,
 * null/undefined.
 */
function parseValue(token: string): unknown {
  if (token === "null") {
    return null;
  }
  if (token === "undefined") {
    return undefined;
  }
  if (token === "true") {
    return true;
  }
  if (token === "false") {
    return false;
  }

  // Quoted string (single or double)
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }

  // Numeric
  const num = Number(token);
  if (!Number.isNaN(num) && token !== "") {
    return num;
  }

  // Fallback: return as string
  return token;
}

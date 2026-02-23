// ---------------------------------------------------------------------------
// Pipeline Executor – Action Nodes (notify, output)
// ---------------------------------------------------------------------------

import type { NotifyConfig, OutputConfig, PipelineNode } from "../types.js";
import type { ExecutorContext, NodeExecutionResult, NodeExecutorFn } from "./types.js";

// ===========================================================================
// Notify Node
// ===========================================================================

export const executeNotifyNode: NodeExecutorFn = async (
  node: PipelineNode,
  input: unknown,
  context: ExecutorContext,
): Promise<NodeExecutionResult> => {
  const startMs = Date.now();
  const config = node.config as NotifyConfig;

  if (!config.channels || config.channels.length === 0) {
    return {
      status: "failure",
      error: "Notify node requires at least one channel",
      durationMs: Date.now() - startMs,
    };
  }

  if (!config.template) {
    return {
      status: "failure",
      error: "Notify node requires a message template",
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
    // Interpolate input into the template.
    const message = interpolateTemplate(config.template, input);

    const result = await context.callGatewayRpc("notification.create", {
      type: "custom",
      title: `Pipeline: ${node.label}`,
      body: message,
      channels: config.channels,
      priority: config.priority ?? "medium",
      source: "pipeline",
    });

    return {
      status: "success",
      output: result,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    context.log?.error("Pipeline notify node failed:", err);
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
};

// ===========================================================================
// Output Node
// ===========================================================================

export const executeOutputNode: NodeExecutorFn = async (
  node: PipelineNode,
  input: unknown,
  _context: ExecutorContext,
): Promise<NodeExecutionResult> => {
  const startMs = Date.now();
  const config = node.config as OutputConfig;

  try {
    let formattedOutput: unknown;

    switch (config.format) {
      case "json":
        formattedOutput = typeof input === "string" ? JSON.parse(input) : input;
        break;
      case "markdown":
        formattedOutput =
          typeof input === "string"
            ? input
            : `\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``;
        break;
      case "text":
      default:
        formattedOutput = typeof input === "string" ? input : JSON.stringify(input);
        break;
    }

    return {
      status: "success",
      output: {
        data: formattedOutput,
        format: config.format,
        destination: config.destination ?? "log",
        path: config.path,
      },
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

/**
 * Simple template interpolation: replaces `{{input}}` and `{{input.path}}`
 * with values from the upstream node output.
 */
function interpolateTemplate(template: string, input: unknown): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_match, path: string) => {
    if (path === "input") {
      return typeof input === "string" ? input : JSON.stringify(input);
    }
    if (path.startsWith("input.")) {
      const segments = path.slice("input.".length).split(".");
      let current: unknown = input;
      for (const seg of segments) {
        if (current === null || current === undefined) {
          return "";
        }
        if (typeof current !== "object") {
          return "";
        }
        current = (current as Record<string, unknown>)[seg];
      }
      return current === undefined || current === null
        ? ""
        : typeof current === "string"
          ? current
          : JSON.stringify(current);
    }
    return `{{${path}}}`;
  });
}

// ---------------------------------------------------------------------------
// Gateway RPC handlers for pipeline.* and node.registry.* methods
// ---------------------------------------------------------------------------

import type { PipelineCreate, PipelinePatch } from "../../pipeline/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { loadPipelineRuns } from "../../pipeline/run-log.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

export const pipelineHandlers: GatewayRequestHandlers = {
  // =========================================================================
  // PIPELINE CRUD
  // =========================================================================

  "pipeline.list": async ({ respond, context }) => {
    if (!context.pipelineService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline service not available"),
      );
      return;
    }
    const pipelines = await context.pipelineService.list();
    respond(true, { pipelines }, undefined);
  },

  "pipeline.get": async ({ params, respond, context }) => {
    if (!context.pipelineService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline service not available"),
      );
      return;
    }
    const id = (params as { id?: string }).id;
    if (!id || typeof id !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const pipeline = await context.pipelineService.get(id);
    if (!pipeline) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `pipeline not found: ${id}`),
      );
      return;
    }
    respond(true, pipeline, undefined);
  },

  "pipeline.create": async ({ params, respond, context }) => {
    if (!context.pipelineService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline service not available"),
      );
      return;
    }
    const input = params as PipelineCreate;
    if (!input.name || typeof input.name !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    const pipeline = await context.pipelineService.create(input);
    respond(true, pipeline, undefined);
  },

  "pipeline.update": async ({ params, respond, context }) => {
    if (!context.pipelineService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline service not available"),
      );
      return;
    }
    const p = params as { id?: string; patch?: PipelinePatch };
    const id = p.id;
    if (!id || typeof id !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const patch = p.patch ?? {};
    try {
      const pipeline = await context.pipelineService.update(id, patch as PipelinePatch);
      respond(true, pipeline, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          (err as Error).message ?? `pipeline not found: ${id}`,
        ),
      );
    }
  },

  "pipeline.delete": async ({ params, respond, context }) => {
    if (!context.pipelineService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline service not available"),
      );
      return;
    }
    const id = (params as { id?: string }).id;
    if (!id || typeof id !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    await context.pipelineService.delete(id);
    respond(true, { ok: true }, undefined);
  },

  "pipeline.activate": async ({ params, respond, context }) => {
    if (!context.pipelineService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline service not available"),
      );
      return;
    }
    const id = (params as { id?: string }).id;
    if (!id || typeof id !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    try {
      const pipeline = await context.pipelineService.activate(id);
      respond(true, pipeline, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          (err as Error).message ?? `pipeline not found: ${id}`,
        ),
      );
    }
  },

  "pipeline.deactivate": async ({ params, respond, context }) => {
    if (!context.pipelineService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline service not available"),
      );
      return;
    }
    const id = (params as { id?: string }).id;
    if (!id || typeof id !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    try {
      const pipeline = await context.pipelineService.deactivate(id);
      respond(true, pipeline, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          (err as Error).message ?? `pipeline not found: ${id}`,
        ),
      );
    }
  },

  // =========================================================================
  // NODE REGISTRY
  // =========================================================================

  // =========================================================================
  // PIPELINE RUNS
  // =========================================================================

  "pipeline.run": async ({ params, respond, context }) => {
    if (!context.pipelineService || !context.pipelineStorePath) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline service not available"),
      );
      return;
    }
    const id = (params as { id?: string }).id;
    if (!id || typeof id !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const pipeline = await context.pipelineService.get(id);
    if (!pipeline) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `pipeline not found: ${id}`),
      );
      return;
    }

    const { appendPipelineRun } = await import("../../pipeline/run-log.js");
    const { executePipeline } = await import("../../pipeline/executor/run.js");

    const run = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pipelineId: id,
      status: "running" as const,
      trigger: "manual",
      nodeResults: [] as import("../../pipeline/types.js").PipelineRunNodeResult[],
      startedAtMs: Date.now(),
    };

    await appendPipelineRun(context.pipelineStorePath, run);

    // Respond immediately so the frontend gets the run record.
    respond(true, run, undefined);

    // Build executor context from gateway context.
    const executorContext: import("../../pipeline/executor/types.js").ExecutorContext = {
      enqueueSystemEvent: (text, opts) => {
        if (opts && typeof (opts as Record<string, unknown>).sessionKey === "string") {
          enqueueSystemEvent(text, opts as { sessionKey: string });
        }
      },
      requestHeartbeatNow: (opts) => requestHeartbeatNow(opts as { reason?: string }),
      callGatewayRpc: async (method: string, rpcParams: unknown) => {
        // Self-call into gateway handlers using a promise-based pattern.
        return new Promise((resolve, reject) => {
          const handler = pipelineHandlers[method];
          if (!handler) {
            reject(new Error(`Unknown RPC method: ${method}`));
            return;
          }
          const fakeRespond: import("./types.js").RespondFn = (ok, payload, error) => {
            if (ok) {
              resolve(payload);
            } else {
              reject(new Error(error?.message ?? "RPC call failed"));
            }
          };
          Promise.resolve(
            handler({
              req: {
                type: "req",
                id: "internal",
                method,
                params: rpcParams as Record<string, unknown>,
              },
              params: (rpcParams ?? {}) as Record<string, unknown>,
              client: null,
              isWebchatConnect: () => false,
              respond: fakeRespond,
              context,
            }),
          ).catch(reject);
        });
      },
      log: {
        info: (...args: unknown[]) =>
          context.logGateway?.info(`[pipeline:run] ${args.map(String).join(" ")}`),
        error: (...args: unknown[]) =>
          context.logGateway?.error(`[pipeline:run] ${args.map(String).join(" ")}`),
      },
    };

    // Run execution asynchronously — broadcast events as they happen.
    const storePath = context.pipelineStorePath;
    executePipeline(pipeline, run, executorContext, (event) => {
      // Broadcast each event to connected clients.
      context.broadcast(`pipeline.${event.type}`, event);
    })
      .then(async (completedRun) => {
        // Persist the completed run record.
        await appendPipelineRun(storePath, completedRun);
      })
      .catch((err) => {
        context.logGateway?.error?.("[pipeline:run] execution failed:", err);
        // Broadcast a run_completed failure event.
        context.broadcast("pipeline.run_completed", {
          type: "run_completed",
          runId: run.id,
          pipelineId: id,
          timestamp: Date.now(),
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      });
  },

  "pipeline.runs": async ({ params, respond, context }) => {
    if (!context.pipelineStorePath) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline service not available"),
      );
      return;
    }
    const p = params as { id?: string; limit?: number };
    const id = p.id;
    if (!id || typeof id !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const runs = await loadPipelineRuns(context.pipelineStorePath, id, p.limit);
    respond(true, { runs }, undefined);
  },

  // =========================================================================
  // NODE REGISTRY
  // =========================================================================

  "node.registry.list": async ({ respond, context }) => {
    if (!context.pipelineNodeRegistry) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "pipeline node registry not available"),
      );
      return;
    }
    const definitions = context.pipelineNodeRegistry.list();
    respond(true, { definitions }, undefined);
  },
};

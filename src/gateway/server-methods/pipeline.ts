// ---------------------------------------------------------------------------
// Gateway RPC handlers for pipeline.* and node.registry.* methods
// ---------------------------------------------------------------------------

import type { PipelineCreate, PipelinePatch } from "../../pipeline/types.js";
import type { GatewayRequestHandlers } from "./types.js";
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

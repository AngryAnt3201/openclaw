// ---------------------------------------------------------------------------
// Gateway RPC handlers for widget.* methods – follows tasks.ts pattern
// ---------------------------------------------------------------------------

import type {
  WidgetDefinitionFilter,
  WidgetInstanceFilter,
  WidgetInstancePatch,
} from "../../widgets/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

export const widgetHandlers: GatewayRequestHandlers = {
  // =========================================================================
  // Registry (definitions)
  // =========================================================================

  // -------------------------------------------------------------------------
  // widget.registry.list
  // -------------------------------------------------------------------------
  "widget.registry.list": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const filter = (params ?? {}) as WidgetDefinitionFilter;
    const definitions = await context.widgetService.listDefinitions(filter);
    respond(true, { definitions }, undefined);
  },

  // -------------------------------------------------------------------------
  // widget.registry.get
  // -------------------------------------------------------------------------
  "widget.registry.get": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const definitionId = requireString(params, "definitionId") ?? requireString(params, "id");
    if (!definitionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing definitionId"));
      return;
    }
    const definition = await context.widgetService.getDefinition(definitionId);
    if (!definition) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `definition not found: ${definitionId}`),
      );
      return;
    }
    respond(true, definition, undefined);
  },

  // -------------------------------------------------------------------------
  // widget.registry.create
  // -------------------------------------------------------------------------
  "widget.registry.create": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    try {
      const definition = await context.widgetService.createDefinition(params as any);
      respond(true, { definition }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  // -------------------------------------------------------------------------
  // widget.registry.delete
  // -------------------------------------------------------------------------
  "widget.registry.delete": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const definitionId = requireString(params, "definitionId") ?? requireString(params, "id");
    if (!definitionId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing definitionId"));
      return;
    }
    const deleted = await context.widgetService.deleteDefinition(definitionId);
    if (!deleted) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `definition not found or cannot be deleted: ${definitionId}`,
        ),
      );
      return;
    }
    respond(true, { deleted: true }, undefined);
  },

  // =========================================================================
  // Instances
  // =========================================================================

  // -------------------------------------------------------------------------
  // widget.instance.spawn
  // -------------------------------------------------------------------------
  "widget.instance.spawn": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    try {
      const instance = await context.widgetService.spawnInstance(params as any);
      respond(true, { instance }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  // -------------------------------------------------------------------------
  // widget.instance.dismiss
  // -------------------------------------------------------------------------
  "widget.instance.dismiss": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const instanceId = requireString(params, "instanceId") ?? requireString(params, "id");
    if (!instanceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing instanceId"));
      return;
    }
    const dismissed = await context.widgetService.dismissInstance(instanceId);
    if (!dismissed) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `instance not found: ${instanceId}`),
      );
      return;
    }
    respond(true, { dismissed: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // widget.instance.list
  // -------------------------------------------------------------------------
  "widget.instance.list": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const filter = (params ?? {}) as WidgetInstanceFilter;
    const instances = await context.widgetService.listInstances(filter);
    respond(true, { instances }, undefined);
  },

  // -------------------------------------------------------------------------
  // widget.instance.update
  // -------------------------------------------------------------------------
  "widget.instance.update": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const instanceId = requireString(params, "instanceId") ?? requireString(params, "id");
    if (!instanceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing instanceId"));
      return;
    }
    const patch: WidgetInstancePatch = {};
    if (params.position !== undefined) {
      patch.position = params.position as any;
    }
    if (params.dimensions !== undefined) {
      patch.dimensions = params.dimensions as any;
    }
    if (params.pinned !== undefined) {
      patch.pinned = params.pinned as boolean;
    }
    if (params.minimized !== undefined) {
      patch.minimized = params.minimized as boolean;
    }
    if (params.data !== undefined) {
      patch.data = params.data as Record<string, unknown>;
    }
    if (params.config !== undefined) {
      patch.config = params.config as Record<string, unknown>;
    }

    const instance = await context.widgetService.updateInstance(instanceId, patch);
    if (!instance) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `instance not found: ${instanceId}`),
      );
      return;
    }
    respond(true, { instance }, undefined);
  },

  // =========================================================================
  // Data
  // =========================================================================

  // -------------------------------------------------------------------------
  // widget.data.push
  // -------------------------------------------------------------------------
  "widget.data.push": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const instanceId = requireString(params, "instanceId") ?? requireString(params, "id");
    if (!instanceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing instanceId"));
      return;
    }
    if (!params.data || typeof params.data !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing data"));
      return;
    }
    const pushed = await context.widgetService.pushData(
      instanceId,
      params.data as Record<string, unknown>,
    );
    if (!pushed) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `instance not found: ${instanceId}`),
      );
      return;
    }
    respond(true, { pushed: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // widget.data.stream.create
  // -------------------------------------------------------------------------
  "widget.data.stream.create": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    try {
      const source = await context.widgetService.createDataSource(params as any);
      respond(true, { source }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  // -------------------------------------------------------------------------
  // widget.data.stream.push
  // -------------------------------------------------------------------------
  "widget.data.stream.push": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const streamId = requireString(params, "streamId") ?? requireString(params, "id");
    if (!streamId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing streamId"));
      return;
    }
    if (params.value === undefined) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing value"));
      return;
    }
    const pushed = await context.widgetService.pushToStream(streamId, params.value);
    if (!pushed) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `stream not found: ${streamId}`),
      );
      return;
    }
    respond(true, { pushed: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // widget.data.stream.list
  // -------------------------------------------------------------------------
  "widget.data.stream.list": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const sources = await context.widgetService.listDataSources();
    respond(true, { sources }, undefined);
  },

  // -------------------------------------------------------------------------
  // widget.data.stream.get
  // -------------------------------------------------------------------------
  "widget.data.stream.get": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const streamId = requireString(params, "streamId") ?? requireString(params, "id");
    if (!streamId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing streamId"));
      return;
    }
    const source = await context.widgetService.getDataSource(streamId);
    if (!source) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `stream not found: ${streamId}`),
      );
      return;
    }
    respond(true, source, undefined);
  },

  // -------------------------------------------------------------------------
  // widget.data.stream.delete
  // -------------------------------------------------------------------------
  "widget.data.stream.delete": async ({ params, respond, context }) => {
    if (!context.widgetService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "widget service not available"));
      return;
    }
    const streamId = requireString(params, "streamId") ?? requireString(params, "id");
    if (!streamId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing streamId"));
      return;
    }
    const deleted = await context.widgetService.deleteDataSource(streamId);
    if (!deleted) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `stream not found: ${streamId}`),
      );
      return;
    }
    respond(true, { deleted: true }, undefined);
  },
};

// ---------------------------------------------------------------------------
// Widget Agent Tool – allows agents to manage dashboard widgets
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const WIDGET_ACTIONS = [
  "define",
  "spawn",
  "dismiss",
  "update",
  "stream",
  "list",
  "configure",
  "remove",
] as const;

const WidgetToolSchema = Type.Object({
  action: stringEnum(WIDGET_ACTIONS),
  // define
  name: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  schema: Type.Optional(Type.Any()),
  // spawn/dismiss/update/configure
  definitionId: Type.Optional(Type.String()),
  instanceId: Type.Optional(Type.String()),
  data: Type.Optional(Type.Any()),
  config: Type.Optional(Type.Any()),
  // stream
  streamId: Type.Optional(Type.String()),
  streamName: Type.Optional(Type.String()),
  value: Type.Optional(Type.Any()),
  // iframe config (for define action with type: "iframe")
  iframeConfig: Type.Optional(
    Type.Object({
      mode: stringEnum(["url", "inline"] as const),
      url: Type.Optional(Type.String()),
      html: Type.Optional(Type.String()),
    }),
  ),
});

export function createWidgetTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Widget",
    name: "widget",
    description:
      "Manage dashboard widgets. Actions: define, spawn, dismiss, update, stream, list, configure, remove.",
    parameters: WidgetToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = {};

      switch (action) {
        case "define": {
          const name = readStringParam(params, "name", { required: true });
          const payload: Record<string, unknown> = { name };
          if (params.type) {
            payload.type = params.type;
          }
          if (params.category) {
            payload.category = params.category;
          }
          if (params.description) {
            payload.description = params.description;
          }
          if (params.schema !== undefined) {
            payload.schema = params.schema;
          }
          if (params.iframeConfig !== undefined) {
            // Merge iframeConfig into schema for iframe widget definitions
            payload.schema = {
              ...((payload.schema as Record<string, unknown>) ?? {}),
              iframe: params.iframeConfig,
            };
          }
          const result = await callGatewayTool("widget.registry.create", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "spawn": {
          const definitionId = readStringParam(params, "definitionId", { required: true });
          const payload: Record<string, unknown> = { definitionId };
          if (params.data !== undefined) {
            payload.data = params.data;
          }
          if (params.config !== undefined) {
            payload.config = params.config;
          }
          if (opts?.agentSessionKey) {
            payload.spawnedBy = opts.agentSessionKey;
          }
          const result = await callGatewayTool("widget.instance.spawn", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "dismiss": {
          const instanceId = readStringParam(params, "instanceId", { required: true });
          const result = await callGatewayTool("widget.instance.dismiss", gatewayOpts, {
            instanceId,
          });
          return jsonResult(result);
        }
        case "update": {
          const instanceId = readStringParam(params, "instanceId", { required: true });
          const payload: Record<string, unknown> = { instanceId };
          if (params.data !== undefined) {
            payload.data = params.data;
          }
          // If only data is provided with no config, use widget.data.push for direct data updates
          if (params.data !== undefined && params.config === undefined) {
            const result = await callGatewayTool("widget.data.push", gatewayOpts, payload);
            return jsonResult(result);
          }
          if (params.config !== undefined) {
            payload.config = params.config;
          }
          const result = await callGatewayTool("widget.instance.update", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "stream": {
          // Create a new stream or push to an existing one
          const streamId = readStringParam(params, "streamId");
          if (streamId) {
            // Push to existing stream
            const payload: Record<string, unknown> = { streamId };
            if (params.value !== undefined) {
              payload.value = params.value;
            }
            if (params.data !== undefined) {
              payload.data = params.data;
            }
            const result = await callGatewayTool("widget.data.stream.push", gatewayOpts, payload);
            return jsonResult(result);
          }
          // Create new stream
          const streamName = readStringParam(params, "streamName", { required: true });
          const payload: Record<string, unknown> = { streamName };
          if (params.instanceId) {
            payload.instanceId = params.instanceId;
          }
          if (params.value !== undefined) {
            payload.value = params.value;
          }
          const result = await callGatewayTool("widget.data.stream.create", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "list": {
          const [registry, instances] = await Promise.all([
            callGatewayTool("widget.registry.list", gatewayOpts, {}),
            callGatewayTool("widget.instance.list", gatewayOpts, {}),
          ]);
          return jsonResult({ registry, instances });
        }
        case "configure": {
          const instanceId = readStringParam(params, "instanceId", { required: true });
          const payload: Record<string, unknown> = { instanceId };
          if (params.config !== undefined) {
            payload.config = params.config;
          }
          if (params.data !== undefined) {
            payload.data = params.data;
          }
          const result = await callGatewayTool("widget.instance.update", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "remove": {
          const definitionId = readStringParam(params, "definitionId", { required: true });
          const result = await callGatewayTool("widget.registry.delete", gatewayOpts, {
            definitionId,
          });
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown widget action: ${action}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Pipeline Agent Tool – allows agents to create, manage, and query pipelines
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const PIPELINE_ACTIONS = [
  "create",
  "list",
  "get",
  "update",
  "delete",
  "add_node",
  "remove_node",
  "connect_nodes",
  "disconnect_nodes",
  "run",
  "list_node_types",
] as const;

const NodeInputSchema = Type.Object({
  type: Type.String({ description: "Node type (agent, code, condition, notify, etc.)" }),
  label: Type.String(),
  config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  position: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() })),
});

const EdgeInputSchema = Type.Object({
  source: Type.String({ description: "Source node ID" }),
  target: Type.String({ description: "Target node ID" }),
  sourceHandle: Type.Optional(Type.String()),
  targetHandle: Type.Optional(Type.String()),
});

const PipelineToolSchema = Type.Object({
  action: stringEnum(PIPELINE_ACTIONS),
  // create
  name: Type.Optional(Type.String({ description: "Pipeline name" })),
  description: Type.Optional(Type.String()),
  nodes: Type.Optional(Type.Array(NodeInputSchema)),
  edges: Type.Optional(Type.Array(EdgeInputSchema)),
  // get/update/delete/run
  id: Type.Optional(Type.String({ description: "Pipeline ID" })),
  pipelineId: Type.Optional(Type.String({ description: "Pipeline ID (alias)" })),
  // update
  patch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  // add_node
  node: Type.Optional(NodeInputSchema),
  // remove_node
  nodeId: Type.Optional(Type.String()),
  // connect/disconnect
  edge: Type.Optional(EdgeInputSchema),
  edgeId: Type.Optional(Type.String()),
  // list
  limit: Type.Optional(Type.Number()),
});

export function createPipelineTool(): AnyAgentTool {
  return {
    label: "Pipeline",
    name: "pipeline",
    description:
      "Manage automation pipelines (visual DAG workflows). " +
      "Create pipelines with trigger, agent, code, condition, and action nodes. " +
      "Connect nodes with edges to define data flow. Run pipelines on demand.",
    parameters: PipelineToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "create": {
          const name = readStringParam(params, "name", { required: true });
          const description = readStringParam(params, "description") ?? "";
          const payload: Record<string, unknown> = { name, description };
          if (params.nodes) {
            payload.nodes = params.nodes;
          }
          if (params.edges) {
            payload.edges = params.edges;
          }
          return jsonResult(await callGatewayTool("pipeline.create", {}, payload));
        }
        case "list": {
          return jsonResult(await callGatewayTool("pipeline.list", {}, {}));
        }
        case "get": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "pipelineId");
          if (!id) {
            throw new Error("id is required");
          }
          return jsonResult(await callGatewayTool("pipeline.get", {}, { id }));
        }
        case "update": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "pipelineId");
          if (!id) {
            throw new Error("id is required");
          }
          return jsonResult(
            await callGatewayTool("pipeline.update", {}, { id, patch: params.patch ?? {} }),
          );
        }
        case "delete": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "pipelineId");
          if (!id) {
            throw new Error("id is required");
          }
          return jsonResult(await callGatewayTool("pipeline.delete", {}, { id }));
        }
        case "add_node": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "pipelineId");
          if (!id) {
            throw new Error("id is required");
          }
          if (!params.node) {
            throw new Error("node is required");
          }
          const current = (await callGatewayTool("pipeline.get", {}, { id })) as Record<
            string,
            unknown
          >;
          const nodes = [...((current.nodes as unknown[]) ?? []), params.node];
          return jsonResult(await callGatewayTool("pipeline.update", {}, { id, patch: { nodes } }));
        }
        case "remove_node": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "pipelineId");
          const nodeId = readStringParam(params, "nodeId", { required: true });
          if (!id) {
            throw new Error("id is required");
          }
          const current = (await callGatewayTool("pipeline.get", {}, { id })) as Record<
            string,
            unknown
          >;
          const nodes = ((current.nodes as Array<{ id: string }>) ?? []).filter(
            (n) => n.id !== nodeId,
          );
          const edges = ((current.edges as Array<{ source: string; target: string }>) ?? []).filter(
            (e) => e.source !== nodeId && e.target !== nodeId,
          );
          return jsonResult(
            await callGatewayTool("pipeline.update", {}, { id, patch: { nodes, edges } }),
          );
        }
        case "connect_nodes": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "pipelineId");
          if (!id) {
            throw new Error("id is required");
          }
          if (!params.edge) {
            throw new Error("edge is required");
          }
          const current = (await callGatewayTool("pipeline.get", {}, { id })) as Record<
            string,
            unknown
          >;
          const edges = [...((current.edges as unknown[]) ?? []), params.edge];
          return jsonResult(await callGatewayTool("pipeline.update", {}, { id, patch: { edges } }));
        }
        case "disconnect_nodes": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "pipelineId");
          const edgeId = readStringParam(params, "edgeId", { required: true });
          if (!id) {
            throw new Error("id is required");
          }
          const current = (await callGatewayTool("pipeline.get", {}, { id })) as Record<
            string,
            unknown
          >;
          const edges = ((current.edges as Array<{ id: string }>) ?? []).filter(
            (e) => e.id !== edgeId,
          );
          return jsonResult(await callGatewayTool("pipeline.update", {}, { id, patch: { edges } }));
        }
        case "run": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "pipelineId");
          if (!id) {
            throw new Error("id is required");
          }
          return jsonResult(await callGatewayTool("pipeline.run", {}, { id }));
        }
        case "list_node_types": {
          return jsonResult(await callGatewayTool("node.registry.list", {}, {}));
        }
        default:
          throw new Error(`Unknown pipeline action: ${action}`);
      }
    },
  };
}

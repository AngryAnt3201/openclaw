// ---------------------------------------------------------------------------
// Pipeline Agent Tool – allows agents to create, manage, and query pipelines
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { randomUUID } from "node:crypto";
import { CoreNodeType } from "../../pipeline/types.js";
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

// ---------------------------------------------------------------------------
// Flat node schema – agents write config fields at top level
// ---------------------------------------------------------------------------

const NodeInputSchema = Type.Object({
  type: Type.String({
    description:
      "Node type: cron, webhook, task_event, manual, agent, app, condition, approval, loop, code, notify",
  }),
  label: Type.Optional(Type.String()),
  position: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() })),
  // All node config fields as optional top-level (agent picks what applies)
  prompt: Type.Optional(Type.String({ description: "Prompt for agent/app nodes" })),
  model: Type.Optional(Type.String()),
  session: Type.Optional(Type.String({ description: "'main' or 'isolated'" })),
  timeout: Type.Optional(Type.Number()),
  thinking: Type.Optional(Type.String()),
  credentials: Type.Optional(Type.Array(Type.String())),
  tools: Type.Optional(Type.Array(Type.String())),
  apps: Type.Optional(Type.Array(Type.String())),
  appId: Type.Optional(Type.String()),
  lifecycle: Type.Optional(Type.String()),
  schedule: Type.Optional(Type.String()),
  timezone: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  method: Type.Optional(Type.String()),
  secret: Type.Optional(Type.String()),
  eventFilter: Type.Optional(Type.String()),
  question: Type.Optional(Type.String({ description: "Question for condition router node" })),
  options: Type.Optional(
    Type.Array(Type.String(), { description: "Route options for condition node" }),
  ),
  message: Type.Optional(Type.String()),
  timeoutAction: Type.Optional(Type.String()),
  maxIterations: Type.Optional(Type.Number()),
  condition: Type.Optional(Type.String()),
  description: Type.Optional(Type.String({ description: "Description for code nodes" })),
  language: Type.Optional(Type.String()),
  maxRetries: Type.Optional(Type.Number()),
  channels: Type.Optional(Type.Array(Type.String())),
  priority: Type.Optional(Type.String()),
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

// ---------------------------------------------------------------------------
// Helpers – config extraction from flat fields
// ---------------------------------------------------------------------------

function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) {
      result[k] = obj[k];
    }
  }
  return result;
}

function extractConfig(type: string, n: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case CoreNodeType.Cron:
      return pick(n, ["schedule", "timezone"]);
    case CoreNodeType.Webhook:
      return pick(n, ["path", "method", "secret"]);
    case CoreNodeType.TaskEvent:
      return pick(n, ["eventFilter", "taskType", "taskStatus"]);
    case CoreNodeType.Manual:
      return pick(n, ["label"]);
    case CoreNodeType.Agent:
      return pick(n, [
        "prompt",
        "model",
        "session",
        "timeout",
        "thinking",
        "credentials",
        "tools",
        "apps",
      ]);
    case CoreNodeType.App:
      return pick(n, ["appId", "prompt", "session", "lifecycle", "timeout"]);
    case CoreNodeType.Condition:
      return pick(n, ["question", "options"]);
    case CoreNodeType.Approval:
      return pick(n, ["message", "timeout", "timeoutAction", "approverIds"]);
    case CoreNodeType.Loop:
      return pick(n, ["maxIterations", "condition"]);
    case CoreNodeType.Code:
      return pick(n, ["description", "language", "maxRetries", "timeout"]);
    case CoreNodeType.Notify:
      return pick(n, ["channels", "priority"]);
    default:
      return {};
  }
}

const DEFAULT_LABELS: Record<string, string> = {
  cron: "Cron Schedule",
  webhook: "Webhook",
  task_event: "Task Event",
  manual: "Manual Trigger",
  agent: "Agent",
  app: "App",
  condition: "Condition",
  approval: "Approval",
  loop: "Loop",
  code: "Code",
  notify: "Notify",
};

/** Ensure a node from agent input has all required fields for the canvas. */
function normalizeNode(n: Record<string, unknown>, index: number): Record<string, unknown> {
  const type = n.type as string;
  return {
    id: n.id ?? randomUUID(),
    type,
    label: n.label ?? DEFAULT_LABELS[type] ?? type,
    position: n.position ?? { x: 250 * index, y: 100 },
    config: extractConfig(type, n),
    state: { status: "idle", retryCount: 0 },
  };
}

// ---------------------------------------------------------------------------
// Auto-edge generation – linear flow when no explicit edges
// ---------------------------------------------------------------------------

function autoGenerateEdges(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  const edges: Record<string, unknown>[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: randomUUID(),
      source: nodes[i].id as string,
      target: nodes[i + 1].id as string,
    });
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createPipelineTool(): AnyAgentTool {
  return {
    label: "Pipeline",
    name: "pipeline",
    description:
      "Create and manage automation pipelines. " +
      "Nodes: cron, webhook, task_event, manual (triggers); agent, app, condition, approval, loop, code (processing); notify (actions). " +
      "For linear flows, provide nodes only — edges auto-generated. " +
      "Use explicit edges only for branching (condition/approval). " +
      "Minimal: { action: 'create', name: 'My Flow', nodes: [{ type: 'manual' }, { type: 'agent', prompt: 'Do X' }, { type: 'notify' }] }",
    parameters: PipelineToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      switch (action) {
        case "create": {
          const name = readStringParam(params, "name", { required: true });
          const description = readStringParam(params, "description") ?? "";
          const rawNodes = params.nodes
            ? (params.nodes as Record<string, unknown>[]).map(normalizeNode)
            : [];
          const edges = params.edges
            ? (params.edges as Record<string, unknown>[])
            : rawNodes.length > 1
              ? autoGenerateEdges(rawNodes)
              : [];
          return jsonResult(
            await callGatewayTool(
              "pipeline.create",
              {},
              { name, description, nodes: rawNodes, edges },
            ),
          );
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
          const existingNodes = (current.nodes as unknown[]) ?? [];
          const normalized = normalizeNode(
            params.node as Record<string, unknown>,
            existingNodes.length,
          );
          const nodes = [...existingNodes, normalized];
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

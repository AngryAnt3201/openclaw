// ---------------------------------------------------------------------------
// Task Agent Tool – allows agents to create, update, and query tasks
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const TASK_ACTIONS = ["create", "update", "get", "list", "cancel", "progress"] as const;

const TaskToolSchema = Type.Object({
  action: stringEnum(TASK_ACTIONS),
  // create
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  priority: Type.Optional(Type.String()),
  parentTaskId: Type.Optional(Type.String()),
  // update / get / cancel / progress
  taskId: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  // progress
  progress: Type.Optional(Type.Number()),
  message: Type.Optional(Type.String()),
  // list filters
  limit: Type.Optional(Type.Number()),
  // update patch fields
  inputPrompt: Type.Optional(Type.String()),
  reviewSummary: Type.Optional(Type.String()),
});

export function createTaskTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Task",
    name: "task",
    description:
      "Manage Miranda tasks. Create new tasks, update progress, check status, or cancel tasks. Tasks appear in the user's Miranda Task Queue.",
    parameters: TaskToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const gatewayOpts = {};

      switch (action) {
        case "create": {
          const title = readStringParam(params, "title", { required: true });
          const description = readStringParam(params, "description");
          const type = readStringParam(params, "type") ?? "instruction";
          const source = readStringParam(params, "source") ?? "agent";
          const priority = readStringParam(params, "priority") ?? "medium";
          const parentTaskId = readStringParam(params, "parentTaskId");

          const result = await callGatewayTool("task.create", gatewayOpts, {
            title,
            description,
            type,
            source,
            priority,
            parentTaskId,
          });
          return jsonResult(result);
        }
        case "update": {
          const taskId = readStringParam(params, "taskId") ?? readStringParam(params, "id");
          if (!taskId) {
            throw new Error("taskId is required for task update");
          }

          const patch: Record<string, unknown> = {};
          if (params.status !== undefined) {
            patch.status = params.status;
          }
          if (params.title !== undefined) {
            patch.title = params.title;
          }
          if (params.description !== undefined) {
            patch.description = params.description;
          }
          if (params.priority !== undefined) {
            patch.priority = params.priority;
          }
          if (params.progress !== undefined) {
            patch.progress = params.progress;
          }
          if (params.message !== undefined) {
            patch.progressMessage = params.message;
          }
          if (params.inputPrompt !== undefined) {
            patch.inputPrompt = params.inputPrompt;
          }
          if (params.reviewSummary !== undefined) {
            patch.reviewSummary = params.reviewSummary;
          }

          const result = await callGatewayTool("task.update", gatewayOpts, {
            taskId,
            patch,
          });
          return jsonResult(result);
        }
        case "get": {
          const taskId = readStringParam(params, "taskId") ?? readStringParam(params, "id");
          if (!taskId) {
            throw new Error("taskId is required for task get");
          }
          const result = await callGatewayTool("task.get", gatewayOpts, { taskId });
          return jsonResult(result);
        }
        case "list": {
          const filter: Record<string, unknown> = {};
          if (params.status) {
            filter.status = params.status;
          }
          if (params.source) {
            filter.source = params.source;
          }
          if (params.type) {
            filter.type = params.type;
          }
          if (params.limit) {
            filter.limit = params.limit;
          }
          if (params.parentTaskId) {
            filter.parentTaskId = params.parentTaskId;
          }
          const result = await callGatewayTool("task.list", gatewayOpts, filter);
          return jsonResult(result);
        }
        case "cancel": {
          const taskId = readStringParam(params, "taskId") ?? readStringParam(params, "id");
          if (!taskId) {
            throw new Error("taskId is required for task cancel");
          }
          const result = await callGatewayTool("task.cancel", gatewayOpts, { taskId });
          return jsonResult(result);
        }
        case "progress": {
          const taskId = readStringParam(params, "taskId") ?? readStringParam(params, "id");
          if (!taskId) {
            throw new Error("taskId is required for task progress");
          }
          const progress = readNumberParam(params, "progress", { required: true });
          const message = readStringParam(params, "message");
          const result = await callGatewayTool("task.progress", gatewayOpts, {
            taskId,
            progress,
            message,
          });
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown task action: ${action}`);
      }
    },
  };
}

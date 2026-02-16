// ---------------------------------------------------------------------------
// Workflow Agent Tool – allows agents to create, manage, and query workflows
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const WORKFLOW_ACTIONS = [
  "create",
  "list",
  "get",
  "pause",
  "resume",
  "cancel",
  "retry_step",
  "delete",
  "status",
] as const;

const WORKFLOW_TRIGGERS = ["task", "manual", "issue", "schedule", "webhook"] as const;

const StepInputSchema = Type.Object({
  title: Type.String(),
  description: Type.String(),
  dependsOn: Type.Optional(Type.Array(Type.Number())),
  sessionMode: Type.Optional(Type.String()),
});

const WorkflowToolSchema = Type.Object({
  action: stringEnum(WORKFLOW_ACTIONS),
  // create
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  trigger: Type.Optional(stringEnum(WORKFLOW_TRIGGERS)),
  repoPath: Type.Optional(Type.String({ description: "Path to the git repository" })),
  baseBranch: Type.Optional(Type.String()),
  branchName: Type.Optional(Type.String()),
  sessionMode: Type.Optional(Type.String()),
  steps: Type.Optional(Type.Array(StepInputSchema)),
  taskId: Type.Optional(Type.String()),
  issueNumber: Type.Optional(Type.Number()),
  // get/pause/resume/cancel/delete/status
  id: Type.Optional(Type.String({ description: "Workflow ID" })),
  workflowId: Type.Optional(Type.String({ description: "Workflow ID (alias)" })),
  // retry_step
  stepId: Type.Optional(Type.String()),
  // list
  status: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Number()),
});

export function createWorkflowTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Workflow",
    name: "workflow",
    description:
      "Manage Miranda workflows (multi-step code tasks with git branches and PRs). " +
      "Create workflows to break complex tasks into steps executed by parallel sessions. " +
      "Each workflow gets its own branch and produces a draft PR on completion.",
    parameters: WorkflowToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = {};

      switch (action) {
        case "create": {
          const title = readStringParam(params, "title", { required: true });
          const description = readStringParam(params, "description") ?? "";
          const trigger = readStringParam(params, "trigger") ?? "manual";
          const repoPath = readStringParam(params, "repoPath", { required: true });

          const payload: Record<string, unknown> = {
            title,
            description,
            trigger,
            repoPath,
          };
          if (params.baseBranch) {
            payload.baseBranch = params.baseBranch;
          }
          if (params.branchName) {
            payload.branchName = params.branchName;
          }
          if (params.sessionMode) {
            payload.sessionMode = params.sessionMode;
          }
          if (params.steps) {
            payload.steps = params.steps;
          }
          if (params.taskId) {
            payload.taskId = params.taskId;
          }
          if (params.issueNumber) {
            payload.issueNumber = params.issueNumber;
          }

          const result = await callGatewayTool("workflow.create", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "get":
        case "status": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "workflowId");
          if (!id) {
            throw new Error("id is required");
          }
          const result = await callGatewayTool("workflow.get", gatewayOpts, { id });
          return jsonResult(result);
        }
        case "list": {
          const filter: Record<string, unknown> = {};
          if (params.status) {
            filter.status = params.status;
          }
          if (params.limit) {
            filter.limit = params.limit;
          }
          const result = await callGatewayTool("workflow.list", gatewayOpts, filter);
          return jsonResult(result);
        }
        case "pause": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "workflowId");
          if (!id) {
            throw new Error("id is required");
          }
          const result = await callGatewayTool("workflow.pause", gatewayOpts, { id });
          return jsonResult(result);
        }
        case "resume": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "workflowId");
          if (!id) {
            throw new Error("id is required");
          }
          const result = await callGatewayTool("workflow.resume", gatewayOpts, { id });
          return jsonResult(result);
        }
        case "cancel": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "workflowId");
          if (!id) {
            throw new Error("id is required");
          }
          const result = await callGatewayTool("workflow.cancel", gatewayOpts, { id });
          return jsonResult(result);
        }
        case "retry_step": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "workflowId");
          const stepId = readStringParam(params, "stepId", { required: true });
          if (!id) {
            throw new Error("id is required");
          }
          const result = await callGatewayTool("workflow.retry_step", gatewayOpts, {
            workflowId: id,
            stepId,
          });
          return jsonResult(result);
        }
        case "delete": {
          const id = readStringParam(params, "id") ?? readStringParam(params, "workflowId");
          if (!id) {
            throw new Error("id is required");
          }
          const result = await callGatewayTool("workflow.delete", gatewayOpts, { id });
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown workflow action: ${action}`);
      }
    },
  };
}

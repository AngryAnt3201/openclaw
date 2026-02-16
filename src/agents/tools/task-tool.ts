// ---------------------------------------------------------------------------
// Task Agent Tool – allows agents to create, update, and query tasks
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum, optionalStringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const TASK_ACTIONS = [
  "create",
  "update",
  "get",
  "list",
  "cancel",
  "progress",
  "status_update",
] as const;
const APP_ACTION_TYPES = ["open_url", "deep_link", "launch_native", "noop"] as const;
const APP_REF_STYLES = ["chip", "obsidian-link"] as const;

// Flat action schema — no Type.Union (per tool schema guardrails).
// Agent provides `type` + whichever field applies (url, uri, or appPath).
const AppActionSchema = Type.Object({
  type: stringEnum(APP_ACTION_TYPES, {
    description:
      "open_url: opens a URL in browser. deep_link: opens a URI scheme (e.g. obsidian://...). launch_native: launches a macOS app by path. noop: no action.",
  }),
  url: Type.Optional(Type.String({ description: "URL to open (for open_url)" })),
  uri: Type.Optional(
    Type.String({
      description: "URI scheme to open (for deep_link), e.g. obsidian://open?vault=X&file=Y",
    }),
  ),
  appPath: Type.Optional(
    Type.String({
      description: "macOS .app path (for launch_native), e.g. /Applications/Slack.app",
    }),
  ),
});

const AppReferenceSchema = Type.Object({
  appSlug: Type.String({
    description:
      "Kebab-case app identifier: slack, notion, chrome, terminal, finder, cursor, discord, gmail, obsidian, vscode, figma, github, safari",
  }),
  label: Type.String({
    description: "Short display label, e.g. '#standup', 'vite.config.ts', 'Draft Email'",
  }),
  action: AppActionSchema,
  style: optionalStringEnum(APP_REF_STYLES, {
    description:
      "Visual style. 'obsidian-link' for Notion/Obsidian page links (underlined text with icon). Default: 'chip'",
  }),
  subtitle: Type.Optional(Type.String()),
});

const TaskToolSchema = Type.Object({
  action: stringEnum(TASK_ACTIONS),
  // create
  title: Type.Optional(Type.String()),
  description: Type.Optional(
    Type.String({
      description:
        "Task description. Embed {ref:N} markers to reference entries in the refs array, e.g. 'Drafted email in {ref:0} and saved notes to {ref:1}'",
    }),
  ),
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
  inputPrompt: Type.Optional(
    Type.String({
      description: "Prompt shown when status is input_required. Can contain {ref:N} markers.",
    }),
  ),
  reviewSummary: Type.Optional(
    Type.String({
      description: "Summary shown when status is review. Can contain {ref:N} markers.",
    }),
  ),
  // inline app references
  refs: Type.Optional(
    Type.Array(AppReferenceSchema, {
      description:
        "Array of app references. Text fields use {ref:0}, {ref:1} etc. to embed clickable app chips inline.",
    }),
  ),
  // status_update fields
  updateType: Type.Optional(
    stringEnum(["milestone", "progress", "screenshot", "error", "complete"] as const, {
      description:
        "Type of status update. milestone: major accomplishment. progress: incremental step. screenshot: visual capture. error: encountered error. complete: final summary.",
    }),
  ),
  body: Type.Optional(
    Type.String({
      description:
        "Markdown body for status updates. Describe what happened, what was found, or what changed.",
    }),
  ),
  attachments: Type.Optional(
    Type.Array(
      Type.Object({
        kind: stringEnum(["screenshot", "url", "file_change", "code_snippet", "ref"] as const),
        path: Type.Optional(Type.String()),
        url: Type.Optional(Type.String()),
        caption: Type.Optional(Type.String()),
        title: Type.Optional(Type.String()),
        action: Type.Optional(stringEnum(["created", "modified", "deleted"] as const)),
        language: Type.Optional(Type.String()),
        code: Type.Optional(Type.String()),
        filename: Type.Optional(Type.String()),
        appSlug: Type.Optional(Type.String()),
        label: Type.Optional(Type.String()),
      }),
      {
        description:
          "Attachments for status updates: screenshots, URLs visited, file changes, code snippets.",
      },
    ),
  ),
});

export function createTaskTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Task",
    name: "task",
    description:
      "Manage Miranda tasks. Create new tasks, update progress, check status, cancel tasks, or post status updates. Tasks appear in the user's Miranda Task Queue.\n\nTo embed clickable app references in task text, provide a `refs` array and use `{ref:0}`, `{ref:1}` etc. markers in description/inputPrompt/reviewSummary. Each ref needs: appSlug (e.g. 'slack', 'notion', 'chrome', 'cursor', 'terminal', 'finder', 'discord', 'gmail'), label, and action ({type:'open_url',url:...} or {type:'deep_link',uri:...} or {type:'launch_native',appPath:...}). Use style:'obsidian-link' for note/page links (Notion, Obsidian).\n\nUse action:'status_update' to post milestone cards to the task timeline. Include taskId, title, and optionally body (markdown), updateType (milestone/progress/screenshot/error/complete), progress (0-100), and attachments (URLs visited, files changed, screenshots taken). Post updates at natural breakpoints: completing a major step, resolving an error, finishing research, or completing the task.",
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
          const refs = params.refs as unknown[] | undefined;

          const createPayload: Record<string, unknown> = {
            title,
            description,
            type,
            source,
            priority,
            parentTaskId,
          };
          if (refs && Array.isArray(refs)) {
            createPayload.refs = refs;
          }

          const result = await callGatewayTool("task.create", gatewayOpts, createPayload);
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
          if (params.refs !== undefined && Array.isArray(params.refs)) {
            patch.refs = params.refs;
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
        case "status_update": {
          const taskId = readStringParam(params, "taskId") ?? readStringParam(params, "id");
          if (!taskId) {
            throw new Error("taskId is required for status_update");
          }
          const title = readStringParam(params, "title", { required: true });
          const updatePayload: Record<string, unknown> = {
            taskId,
            title,
          };
          const updateType = readStringParam(params, "updateType");
          if (updateType) {
            updatePayload.type = updateType;
          }
          const body = readStringParam(params, "body");
          if (body) {
            updatePayload.body = body;
          }
          const progress = readNumberParam(params, "progress");
          if (progress !== undefined) {
            updatePayload.progress = progress;
          }
          if (params.attachments && Array.isArray(params.attachments)) {
            updatePayload.attachments = params.attachments;
          }
          updatePayload.source = "agent";

          const result = await callGatewayTool(
            "task.statusUpdate.create",
            gatewayOpts,
            updatePayload,
          );
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown task action: ${action}`);
      }
    },
  };
}

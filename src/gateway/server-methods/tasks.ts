// ---------------------------------------------------------------------------
// Gateway RPC handlers for task.* methods – follows cron.ts pattern
// ---------------------------------------------------------------------------

import type { TaskCreateInput, TaskFilter, TaskPatch, TaskPolicy } from "../../tasks/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

/**
 * When a task receives user input or an approval decision, inject a system
 * event into the agent's session and trigger an immediate heartbeat so the
 * agent processes the event promptly.
 */
function wakeAgentForTask(sessionKey: string | undefined, message: string): void {
  if (!sessionKey) {
    return;
  }
  enqueueSystemEvent(message, { sessionKey });
  requestHeartbeatNow({ reason: `task:${sessionKey}` });
}

export const taskHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // task.list
  // -------------------------------------------------------------------------
  "task.list": async ({ params, respond, context }) => {
    const filter = (params ?? {}) as TaskFilter;
    const tasks = await context.taskService.list(filter);
    respond(true, { tasks }, undefined);
  },

  // -------------------------------------------------------------------------
  // task.get
  // -------------------------------------------------------------------------
  "task.get": async ({ params, respond, context }) => {
    const taskId = requireString(params, "taskId") ?? requireString(params, "id");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing taskId"));
      return;
    }
    const task = await context.taskService.get(taskId);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${taskId}`),
      );
      return;
    }
    respond(true, task, undefined);
  },

  // -------------------------------------------------------------------------
  // task.create
  // -------------------------------------------------------------------------
  "task.create": async ({ params, respond, context }) => {
    const input = params as TaskCreateInput;
    if (!input.title || typeof input.title !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing title"));
      return;
    }
    const task = await context.taskService.create(input);
    respond(true, task, undefined);
  },

  // -------------------------------------------------------------------------
  // task.update
  // -------------------------------------------------------------------------
  "task.update": async ({ params, respond, context }) => {
    const taskId = requireString(params, "taskId") ?? requireString(params, "id");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing taskId"));
      return;
    }
    const patch = (params.patch ?? params) as TaskPatch;
    const task = await context.taskService.update(taskId, patch);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${taskId}`),
      );
      return;
    }
    respond(true, task, undefined);
  },

  // -------------------------------------------------------------------------
  // task.cancel
  // -------------------------------------------------------------------------
  "task.cancel": async ({ params, respond, context }) => {
    const taskId = requireString(params, "taskId") ?? requireString(params, "id");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing taskId"));
      return;
    }
    const task = await context.taskService.cancel(taskId);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${taskId}`),
      );
      return;
    }
    respond(true, task, undefined);
  },

  // -------------------------------------------------------------------------
  // task.respond (provide human input)
  // -------------------------------------------------------------------------
  "task.respond": async ({ params, respond, context }) => {
    const taskId = requireString(params, "taskId") ?? requireString(params, "id");
    const response = requireString(params, "response");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing taskId"));
      return;
    }
    if (!response) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing response"));
      return;
    }
    const task = await context.taskService.respond(taskId, response);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${taskId}`),
      );
      return;
    }

    // Wake the agent so it processes the user input immediately.
    wakeAgentForTask(task.sessionKey, `Task "${task.title}" received user input: ${response}`);

    respond(true, task, undefined);
  },

  // -------------------------------------------------------------------------
  // task.approve
  // -------------------------------------------------------------------------
  "task.approve": async ({ params, respond, context }) => {
    const taskId = requireString(params, "taskId") ?? requireString(params, "id");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing taskId"));
      return;
    }
    const task = await context.taskService.approve(taskId);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${taskId}`),
      );
      return;
    }

    // Wake the agent so it resumes the approved action immediately.
    wakeAgentForTask(
      task.sessionKey,
      `Task "${task.title}" — action approved by user. Proceed with the previously requested operation.`,
    );

    respond(true, task, undefined);
  },

  // -------------------------------------------------------------------------
  // task.reject
  // -------------------------------------------------------------------------
  "task.reject": async ({ params, respond, context }) => {
    const taskId = requireString(params, "taskId") ?? requireString(params, "id");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing taskId"));
      return;
    }
    const reason = requireString(params, "reason") ?? undefined;
    const task = await context.taskService.reject(taskId, reason);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${taskId}`),
      );
      return;
    }

    // Wake the agent so it handles the rejection (find alternative or stop).
    wakeAgentForTask(
      task.sessionKey,
      `Task "${task.title}" — action rejected by user${reason ? `: ${reason}` : ""}. Find an alternative approach or stop.`,
    );

    respond(true, task, undefined);
  },

  // -------------------------------------------------------------------------
  // task.events (read event log)
  // -------------------------------------------------------------------------
  "task.events": async ({ params, respond, context }) => {
    const taskId = requireString(params, "taskId") ?? requireString(params, "id");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing taskId"));
      return;
    }
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const events = await context.taskService.getEvents(taskId, limit);
    respond(true, { events }, undefined);
  },

  // -------------------------------------------------------------------------
  // task.progress
  // -------------------------------------------------------------------------
  "task.progress": async ({ params, respond, context }) => {
    const taskId = requireString(params, "taskId") ?? requireString(params, "id");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing taskId"));
      return;
    }
    const progress = typeof params.progress === "number" ? params.progress : undefined;
    if (progress === undefined) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing progress"));
      return;
    }
    const message = requireString(params, "message") ?? undefined;
    const task = await context.taskService.updateProgress(taskId, progress, message);
    if (!task) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `task not found: ${taskId}`),
      );
      return;
    }
    respond(true, task, undefined);
  },
};

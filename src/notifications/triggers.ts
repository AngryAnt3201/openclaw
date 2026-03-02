// ---------------------------------------------------------------------------
// Notification Triggers – Event-to-notification wiring
// ---------------------------------------------------------------------------
// Listens to task broadcast events at the gateway level and creates
// notifications via NotificationService. Wired at gateway level to avoid
// circular dependencies between TaskService and NotificationService.
// ---------------------------------------------------------------------------

import type { Task } from "../tasks/types.js";
import type { NotificationService } from "./service.js";
import type { NotificationPriority } from "./types.js";

export type TriggerDeps = {
  notificationService: NotificationService;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

/**
 * Creates a broadcast interceptor that listens for task events and creates
 * notifications. Returns a function that should be called with each broadcast
 * event. Designed to wrap the gateway's broadcast function.
 */
export function createNotificationTriggers(deps: TriggerDeps) {
  const { notificationService } = deps;

  async function handleBroadcastEvent(event: string, payload: unknown): Promise<void> {
    try {
      if (event === "task.completed") {
        const task = payload as Task;
        await notificationService.create({
          type: "task_state_change",
          title: "Task completed",
          body: `"${task.title}" finished successfully.`,
          priority: "medium",
          taskId: task.id,
          agentId: task.agentId,
          source: "task.completed",
        });
      } else if (event === "task.updated") {
        const task = payload as Task;
        if (task.status === "failed") {
          await notificationService.create({
            type: "task_state_change",
            title: "Task failed",
            body: `"${task.title}" failed${task.result?.error ? `: ${task.result.error}` : "."}`,
            priority: "critical",
            taskId: task.id,
            agentId: task.agentId,
            source: "task.failed",
          });
        }
      } else if (event === "task.approval_required") {
        const task = payload as Task;
        await notificationService.create({
          type: "approval_request",
          title: "Approval needed",
          body: `"${task.title}" requires your approval${task.approvalRequest ? ` — ${task.approvalRequest.reason}` : "."}`,
          priority: "critical",
          taskId: task.id,
          agentId: task.agentId,
          source: "task.approval_required",
        });
      } else if (event === "task.created") {
        const task = payload as Task;
        if (task.type === "approval_gate") {
          await notificationService.create({
            type: "approval_request",
            title: "Credential access requested",
            body: `"${task.title}" — an agent is requesting credential access.`,
            priority: "critical",
            taskId: task.id,
            agentId: task.agentId,
            source: "task.credential_approval",
          });
        }
      } else if (event === "task.input_required") {
        const task = payload as Task;
        await notificationService.create({
          type: "task_state_change",
          title: "Input needed",
          body: `"${task.title}" is waiting for your input${task.inputPrompt ? `: ${task.inputPrompt}` : "."}`,
          priority: "high",
          taskId: task.id,
          agentId: task.agentId,
          source: "task.input_required",
        });
      }
    } catch (err) {
      deps.log.error(`notification trigger failed for ${event}: ${String(err)}`);
    }
  }

  return { handleBroadcastEvent };
}

/**
 * Creates a notification for an agent error captured by the task monitor.
 */
export async function createAgentErrorNotification(
  service: NotificationService,
  params: {
    taskId?: string;
    agentId?: string;
    error: string;
  },
): Promise<void> {
  await service.create({
    type: "agent_alert",
    title: "Agent error",
    body: params.error,
    priority: "critical",
    taskId: params.taskId,
    agentId: params.agentId,
    source: "agent.error",
  });
}

/**
 * Creates a notification for a scheduled reminder.
 */
export async function createReminderNotification(
  service: NotificationService,
  params: {
    title: string;
    body: string;
    priority?: NotificationPriority;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await service.create({
    type: "scheduled_reminder",
    title: params.title,
    body: params.body,
    priority: params.priority ?? "medium",
    source: "cron",
    data: params.data,
  });
}

/**
 * Creates a notification for an inbound channel message.
 */
export async function createChannelMessageNotification(
  service: NotificationService,
  params: {
    title: string;
    body: string;
    source: string;
    priority?: NotificationPriority;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await service.create({
    type: "message_received",
    title: params.title,
    body: params.body,
    priority: params.priority ?? "medium",
    source: params.source,
    data: params.data,
  });
}

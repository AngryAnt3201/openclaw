// ---------------------------------------------------------------------------
// Heartbeat Task Context – provides active task summaries for the heartbeat prompt
// ---------------------------------------------------------------------------
// Reads the task store and formats a summary of active tasks so the heartbeat
// agent has visibility into the Miranda task queue.
// ---------------------------------------------------------------------------

import type { Task, TaskStatus } from "../tasks/types.js";
import { readTaskStore } from "../tasks/store.js";

const ACTIVE_STATUSES: Set<TaskStatus> = new Set([
  "pending",
  "queued",
  "in_progress",
  "input_required",
  "approval_required",
  "review",
  "paused",
]);

const MAX_TASK_SUMMARY_LINES = 10;

function formatTaskLine(task: Task): string {
  const status = task.status.replace(/_/g, " ");
  const shortId = task.id.length > 8 ? task.id.slice(0, 8) : task.id;
  return `- [${shortId}] "${task.title}" (${status}, ${task.priority})`;
}

/**
 * Read the task store and return a formatted summary of active tasks.
 * Returns `null` if no tasks are active or the store cannot be read.
 */
export async function resolveTaskContextForHeartbeat(
  taskStorePath: string | undefined,
): Promise<string | null> {
  if (!taskStorePath) {
    return null;
  }

  try {
    const store = await readTaskStore(taskStorePath);
    const activeTasks = store.tasks.filter((t) => ACTIVE_STATUSES.has(t.status));

    if (activeTasks.length === 0) {
      return null;
    }

    const lines = activeTasks.slice(0, MAX_TASK_SUMMARY_LINES).map(formatTaskLine);
    const overflow =
      activeTasks.length > MAX_TASK_SUMMARY_LINES
        ? `\n(${activeTasks.length - MAX_TASK_SUMMARY_LINES} more tasks not shown)`
        : "";
    const footer =
      "\n\nIf you discover new work items, create tasks via task_create. " +
      "If you have progress on active tasks, update via task_update.";

    return `\n\nActive tasks (${activeTasks.length}):\n${lines.join("\n")}${overflow}${footer}`;
  } catch {
    return null;
  }
}

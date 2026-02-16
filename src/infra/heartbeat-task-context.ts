// ---------------------------------------------------------------------------
// Heartbeat Task Context – provides active task summaries for the heartbeat prompt
// ---------------------------------------------------------------------------
// Reads the task store and formats a summary of active tasks so the heartbeat
// agent has visibility into the Miranda task queue.
// ---------------------------------------------------------------------------

import type { AppReference, Task, TaskStatus } from "../tasks/types.js";
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

export interface TaskContextSnapshot {
  /** Formatted text for the agent system prompt (null if no active tasks). */
  contextText: string | null;
  /** Refs array with indices aligned to the {ref:N} markers in contextText. */
  refs: AppReference[];
}

function formatTaskLine(task: Task, taskRefIndex: number, appRefOffset: number): string {
  const status = task.status.replace(/_/g, " ");
  // {ref:taskRefIndex} renders as a clickable task chip showing the task title.
  // The quoted title is for the agent's context — it won't appear in the UI.
  let line = `- {ref:${taskRefIndex}} "${task.title}" (${status}, ${task.priority})`;
  if (task.refs && task.refs.length > 0) {
    const refLines = task.refs.map((ref, i) => `  {ref:${appRefOffset + i}} ${ref.label}`);
    line += "\n" + refLines.join("\n");
  }
  return line;
}

/**
 * Build BOTH the context text and refs array from a single store read.
 * This guarantees index alignment between {ref:N} markers in the text and
 * the AppReference entries in the refs array.
 *
 * Ref layout:
 * - Indices 0..N-1 = task-level refs (clickable task chips)
 * - Indices N..    = app refs from within tasks
 */
export async function resolveTaskContextSnapshot(
  taskStorePath: string | undefined,
): Promise<TaskContextSnapshot> {
  if (!taskStorePath) {
    return { contextText: null, refs: [] };
  }

  try {
    const store = await readTaskStore(taskStorePath);
    // Sort by createdAtMs so indices are stable across reads regardless of
    // insertion/update order in the store file.
    const activeTasks = store.tasks
      .filter((t) => ACTIVE_STATUSES.has(t.status))
      .toSorted((a, b) => a.createdAtMs - b.createdAtMs);

    if (activeTasks.length === 0) {
      return { contextText: null, refs: [] };
    }

    const limited = activeTasks.slice(0, MAX_TASK_SUMMARY_LINES);
    const taskCount = limited.length;

    // ── Build refs array ──
    const refs: AppReference[] = [];

    // Task-level refs first (indices 0..N-1)
    for (const task of limited) {
      refs.push({
        appSlug: "miranda-task",
        label: task.title,
        action: { type: "open_task", taskId: task.id },
      });
    }

    // App refs from within tasks (indices N..)
    for (const task of limited) {
      if (!task.refs) {
        continue;
      }
      for (const ref of task.refs) {
        refs.push(ref);
      }
    }

    // ── Build context text ──
    let appRefOffset = taskCount;
    const lines = limited.map((task, i) => {
      const line = formatTaskLine(task, i, appRefOffset);
      appRefOffset += task.refs?.length ?? 0;
      return line;
    });

    const overflow =
      activeTasks.length > MAX_TASK_SUMMARY_LINES
        ? `\n(${activeTasks.length - MAX_TASK_SUMMARY_LINES} more tasks not shown)`
        : "";
    const footer =
      "\n\nIMPORTANT: When referencing tasks in your response, ALWAYS use {ref:N} " +
      "where N is the task's index above (e.g. {ref:0} for the first task). " +
      "These render as clickable task chips in the UI. The {ref:N} entries listed " +
      "under each task are app resources (Google Search, LinkedIn, etc.) — only " +
      "use those when you need to reference the specific app, not the task itself.\n" +
      "If you discover new work items, create tasks via task_create. " +
      "If you have progress on active tasks, update via task_update.";

    const contextText = `\n\nActive tasks (${activeTasks.length}):\n${lines.join("\n")}${overflow}${footer}`;

    return { contextText, refs };
  } catch {
    return { contextText: null, refs: [] };
  }
}

/**
 * Read the task store and return a formatted summary of active tasks.
 * Returns `null` if no tasks are active or the store cannot be read.
 *
 * @deprecated Use `resolveTaskContextSnapshot()` instead to get both context
 * text and refs from a single store read, guaranteeing index alignment.
 */
export async function resolveTaskContextForHeartbeat(
  taskStorePath: string | undefined,
): Promise<string | null> {
  const snapshot = await resolveTaskContextSnapshot(taskStorePath);
  return snapshot.contextText;
}

/**
 * Build the refs array for a chat session.
 *
 * @deprecated Use `resolveTaskContextSnapshot()` instead to get both context
 * text and refs from a single store read, guaranteeing index alignment.
 */
export async function resolveTaskRefsForSession(
  taskStorePath: string | undefined,
): Promise<AppReference[]> {
  const snapshot = await resolveTaskContextSnapshot(taskStorePath);
  return snapshot.refs;
}

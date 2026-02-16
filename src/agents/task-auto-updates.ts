// ---------------------------------------------------------------------------
// Task Auto-Updates – synthesizes lightweight status updates from event patterns
// ---------------------------------------------------------------------------
// Watches the task event stream and generates auto-updates when:
//   - A screenshot is captured
//   - N tool calls have accumulated (threshold: 5)
//   - An error event occurs
// Respects a 30-second cooldown between auto-updates per task.
// ---------------------------------------------------------------------------

import type { TaskEvent } from "../tasks/types.js";
import type { StatusUpdateCreateInput } from "../tasks/types.js";

// ---------------------------------------------------------------------------
// Per-task buffer state
// ---------------------------------------------------------------------------

interface TaskBuffer {
  toolCalls: string[]; // tool names accumulated since last update
  lastUpdateMs: number; // timestamp of last auto-update
}

const buffers = new Map<string, TaskBuffer>();

const TOOL_CALL_THRESHOLD = 5;
const COOLDOWN_MS = 30_000;

function getBuffer(taskId: string): TaskBuffer {
  let buf = buffers.get(taskId);
  if (!buf) {
    buf = { toolCalls: [], lastUpdateMs: 0 };
    buffers.set(taskId, buf);
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a task event should trigger an auto-synthesized status update.
 * Returns a StatusUpdateCreateInput if an update should be created, null otherwise.
 */
export function shouldAutoUpdate(
  taskId: string,
  event: TaskEvent,
  nowMs?: number,
): StatusUpdateCreateInput | null {
  const now = nowMs ?? Date.now();
  const buf = getBuffer(taskId);

  // Cooldown check (skip if no prior update has been emitted)
  if (buf.lastUpdateMs > 0 && now - buf.lastUpdateMs < COOLDOWN_MS) {
    // Still accumulate tool calls even during cooldown
    if (event.type === "tool_use") {
      const toolName = (event.data?.toolName as string) ?? "unknown";
      buf.toolCalls.push(toolName);
    }
    return null;
  }

  // Screenshot captured
  if (event.type === "screenshot") {
    buf.lastUpdateMs = now;
    const url = (event.data?.url as string) ?? undefined;
    const screenshotPath = (event.data?.path as string) ?? undefined;
    return {
      taskId,
      type: "screenshot",
      title: url ? `Screenshot: ${new URL(url).hostname}` : "Screenshot captured",
      body: url ? `Captured screenshot at ${url}` : "Captured a screenshot",
      attachments: screenshotPath
        ? [{ kind: "screenshot", path: screenshotPath, url, caption: url }]
        : [],
      source: "auto",
    };
  }

  // Error event
  if (event.type === "error") {
    buf.lastUpdateMs = now;
    const errorMsg = (event.data?.error as string) ?? event.message;
    const toolName = (event.data?.toolName as string) ?? undefined;
    return {
      taskId,
      type: "error",
      title: toolName ? `Error in ${toolName}` : "Error encountered",
      body: errorMsg.length > 200 ? errorMsg.slice(0, 200) + "..." : errorMsg,
      source: "auto",
    };
  }

  // Tool call accumulation
  if (event.type === "tool_use") {
    const toolName = (event.data?.toolName as string) ?? "unknown";
    buf.toolCalls.push(toolName);

    if (buf.toolCalls.length >= TOOL_CALL_THRESHOLD) {
      buf.lastUpdateMs = now;
      // Summarize tool usage
      const counts = new Map<string, number>();
      for (const t of buf.toolCalls) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const summary = Array.from(counts.entries())
        .map(([name, count]) => (count > 1 ? `${name} (x${count})` : name))
        .join(", ");

      const total = buf.toolCalls.length;
      buf.toolCalls = [];

      return {
        taskId,
        type: "progress",
        title: `${total} tool calls completed`,
        body: `Tools used: ${summary}`,
        source: "auto",
      };
    }
  }

  return null;
}

/**
 * Reset the buffer for a task (e.g. when task completes).
 */
export function clearBuffer(taskId: string): void {
  buffers.delete(taskId);
}

/**
 * Reset all buffers (for testing).
 */
export function resetAllBuffers(): void {
  buffers.clear();
}

// ---------------------------------------------------------------------------
// Task Monitor – captures tool invocations and browser events for task-bound
// sessions, emitting structured task events for the live monitoring view.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { TaskEvent, TaskEventType } from "../tasks/types.js";
import { appendTaskEvent } from "../tasks/store.js";
import { resolveTaskScreenshotDir } from "../tasks/store.js";

// ---------------------------------------------------------------------------
// Session → Task binding
// ---------------------------------------------------------------------------

const sessionToTask = new Map<string, { taskId: string; storePath: string }>();

/**
 * Bind a session to a task so tool invocations during that session
 * are logged to the task event log.
 */
export function bindSessionToTask(sessionKey: string, taskId: string, storePath: string): void {
  sessionToTask.set(sessionKey, { taskId, storePath });
}

/**
 * Unbind a session from its task.
 */
export function unbindSession(sessionKey: string): void {
  sessionToTask.delete(sessionKey);
}

/**
 * Check if a session is bound to a task.
 */
export function getSessionTask(sessionKey: string): { taskId: string; storePath: string } | null {
  return sessionToTask.get(sessionKey) ?? null;
}

/**
 * Reset all bindings (for testing).
 */
export function resetBindingsForTest(): void {
  sessionToTask.clear();
}

// ---------------------------------------------------------------------------
// Event capture helpers
// ---------------------------------------------------------------------------

function makeEvent(
  taskId: string,
  type: TaskEventType,
  message: string,
  data?: Record<string, unknown>,
): TaskEvent {
  return {
    id: randomUUID(),
    taskId,
    type,
    timestamp: Date.now(),
    message,
    data,
  };
}

/**
 * Capture a tool invocation event for a task-bound session.
 */
export async function captureToolEvent(params: {
  sessionKey: string;
  toolName: string;
  toolParams?: Record<string, unknown>;
  result?: string;
  error?: string;
  durationMs?: number;
}): Promise<TaskEvent | null> {
  const binding = sessionToTask.get(params.sessionKey);
  if (!binding) {
    return null;
  }

  const message = params.error
    ? `Tool "${params.toolName}" failed: ${params.error}`
    : `Tool "${params.toolName}" executed (${params.durationMs ?? 0}ms)`;

  const event = makeEvent(binding.taskId, "tool_use", message, {
    toolName: params.toolName,
    params: redactSensitiveParams(params.toolParams ?? {}),
    error: params.error,
    durationMs: params.durationMs,
  });

  await appendTaskEvent(binding.storePath, event);
  return event;
}

/**
 * Capture a browser navigation event.
 */
export async function captureNavigationEvent(params: {
  sessionKey: string;
  url: string;
  title?: string;
}): Promise<TaskEvent | null> {
  const binding = sessionToTask.get(params.sessionKey);
  if (!binding) {
    return null;
  }

  const message = `Navigated to: ${params.url}${params.title ? ` — "${params.title}"` : ""}`;
  const event = makeEvent(binding.taskId, "navigation", message, {
    url: params.url,
    title: params.title,
  });

  await appendTaskEvent(binding.storePath, event);
  return event;
}

/**
 * Capture a screenshot event. Copies the screenshot to the task's screenshot
 * directory and logs a screenshot event.
 */
export async function captureScreenshotEvent(params: {
  sessionKey: string;
  sourcePath: string;
  url?: string;
}): Promise<TaskEvent | null> {
  const binding = sessionToTask.get(params.sessionKey);
  if (!binding) {
    return null;
  }

  const screenshotDir = resolveTaskScreenshotDir(binding.storePath, binding.taskId);

  let destPath: string;
  try {
    await fs.mkdir(screenshotDir, { recursive: true });
    const ext = path.extname(params.sourcePath) || ".png";
    const filename = `${Date.now()}${ext}`;
    destPath = path.join(screenshotDir, filename);
    await fs.copyFile(params.sourcePath, destPath);
  } catch {
    // If copy fails, still log the event with the original path
    destPath = params.sourcePath;
  }

  const message = `Screenshot captured${params.url ? ` at ${params.url}` : ""}`;
  const event = makeEvent(binding.taskId, "screenshot", message, {
    path: destPath,
    url: params.url,
  });

  await appendTaskEvent(binding.storePath, event);
  return event;
}

/**
 * Capture an output/progress event.
 */
export async function captureOutputEvent(params: {
  sessionKey: string;
  text: string;
}): Promise<TaskEvent | null> {
  const binding = sessionToTask.get(params.sessionKey);
  if (!binding) {
    return null;
  }

  const message = params.text.length > 200 ? params.text.slice(0, 200) + "..." : params.text;
  const event = makeEvent(binding.taskId, "output", message, {
    text: params.text,
  });

  await appendTaskEvent(binding.storePath, event);
  return event;
}

/**
 * Capture an error event.
 */
export async function captureErrorEvent(params: {
  sessionKey: string;
  error: string;
  toolName?: string;
}): Promise<TaskEvent | null> {
  const binding = sessionToTask.get(params.sessionKey);
  if (!binding) {
    return null;
  }

  const message = params.toolName
    ? `Error in ${params.toolName}: ${params.error}`
    : `Error: ${params.error}`;
  const event = makeEvent(binding.taskId, "error", message, {
    error: params.error,
    toolName: params.toolName,
  });

  await appendTaskEvent(binding.storePath, event);
  return event;
}

// ---------------------------------------------------------------------------
// Sensitive param redaction
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "secret",
  "key",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "credentials",
]);

function redactSensitiveParams(params: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      redacted[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 500) {
      redacted[k] = v.slice(0, 500) + "...";
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

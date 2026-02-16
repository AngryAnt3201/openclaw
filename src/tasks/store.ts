// ---------------------------------------------------------------------------
// Task Store – File-based persistence following CronService store pattern
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/tasks/
//     store.json              – { version: 1, tasks: Task[] }
//     events/{task-id}.jsonl  – Append-only event log per task
//     screenshots/{task-id}/  – Browser screenshots
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TaskStoreFile, TaskEvent, StatusUpdate } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveTaskStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "tasks", "store.json");
}

export function resolveTaskEventsDir(storePath: string): string {
  return path.join(path.dirname(storePath), "events");
}

export function resolveTaskEventLogPath(storePath: string, taskId: string): string {
  return path.join(resolveTaskEventsDir(storePath), `${taskId}.jsonl`);
}

export function resolveTaskScreenshotDir(storePath: string, taskId: string): string {
  return path.join(path.dirname(storePath), "screenshots", taskId);
}

export function resolveTaskUpdatesDir(storePath: string): string {
  return path.join(path.dirname(storePath), "updates");
}

export function resolveTaskUpdateLogPath(storePath: string, taskId: string): string {
  return path.join(resolveTaskUpdatesDir(storePath), `${taskId}.jsonl`);
}

// ---------------------------------------------------------------------------
// Read / write store file (atomic)
// ---------------------------------------------------------------------------

function emptyStore(): TaskStoreFile {
  return { version: 1, tasks: [] };
}

export async function readTaskStore(storePath: string): Promise<TaskStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as TaskStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function writeTaskStore(storePath: string, store: TaskStoreFile): Promise<void> {
  const dir = path.dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = storePath + ".tmp";
  const content = JSON.stringify(store, null, 2);
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, storePath);
}

// ---------------------------------------------------------------------------
// Event log (append-only JSONL)
// ---------------------------------------------------------------------------

export async function appendTaskEvent(storePath: string, event: TaskEvent): Promise<void> {
  const eventsDir = resolveTaskEventsDir(storePath);
  if (!existsSync(eventsDir)) {
    mkdirSync(eventsDir, { recursive: true });
  }
  const logPath = resolveTaskEventLogPath(storePath, event.taskId);
  const line = JSON.stringify(event) + "\n";
  await fs.appendFile(logPath, line, "utf-8");
}

export async function readTaskEvents(
  storePath: string,
  taskId: string,
  opts?: { limit?: number },
): Promise<TaskEvent[]> {
  const logPath = resolveTaskEventLogPath(storePath, taskId);
  try {
    const raw = await fs.readFile(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const events: TaskEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as TaskEvent);
      } catch {
        // Skip malformed lines
      }
    }
    if (opts?.limit && opts.limit > 0) {
      return events.slice(-opts.limit);
    }
    return events;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Status update log (append-only JSONL, per task)
// ---------------------------------------------------------------------------

export async function appendStatusUpdate(storePath: string, update: StatusUpdate): Promise<void> {
  const updatesDir = resolveTaskUpdatesDir(storePath);
  if (!existsSync(updatesDir)) {
    mkdirSync(updatesDir, { recursive: true });
  }
  const logPath = resolveTaskUpdateLogPath(storePath, update.taskId);
  const line = JSON.stringify(update) + "\n";
  await fs.appendFile(logPath, line, "utf-8");
}

export async function readStatusUpdates(
  storePath: string,
  taskId: string,
  opts?: { limit?: number; since?: number },
): Promise<StatusUpdate[]> {
  const logPath = resolveTaskUpdateLogPath(storePath, taskId);
  try {
    const raw = await fs.readFile(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    let updates: StatusUpdate[] = [];
    for (const line of lines) {
      try {
        updates.push(JSON.parse(line) as StatusUpdate);
      } catch {
        // Skip malformed lines
      }
    }
    if (opts?.since && opts.since > 0) {
      updates = updates.filter((u) => u.timestamp > opts.since!);
    }
    if (opts?.limit && opts.limit > 0) {
      return updates.slice(-opts.limit);
    }
    return updates;
  } catch {
    return [];
  }
}

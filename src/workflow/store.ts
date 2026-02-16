// ---------------------------------------------------------------------------
// Workflow Store – File-based persistence following task store pattern
// ---------------------------------------------------------------------------
// Storage layout:
//   ~/.openclaw/workflows/
//     store.json              – { version: 1, workflows: Workflow[] }
//     events/{workflow-id}.jsonl – Append-only event log per workflow
//     policies.json           – WorkflowPolicies
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Workflow, WorkflowStoreFile, WorkflowEvent, WorkflowPolicies } from "./types.js";
import { defaultPolicies } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_DIR = ".openclaw";

export function resolveWorkflowStorePath(customPath?: string): string {
  if (customPath) {
    return path.resolve(customPath);
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return path.join(home, DEFAULT_DIR, "workflows", "store.json");
}

export function resolveWorkflowEventsDir(storePath: string): string {
  return path.join(path.dirname(storePath), "events");
}

export function resolveWorkflowEventLogPath(storePath: string, workflowId: string): string {
  return path.join(resolveWorkflowEventsDir(storePath), `${workflowId}.jsonl`);
}

export function resolveWorkflowPoliciesPath(storePath: string): string {
  return path.join(path.dirname(storePath), "policies.json");
}

// ---------------------------------------------------------------------------
// Read / write store file (atomic)
// ---------------------------------------------------------------------------

function emptyStore(): WorkflowStoreFile {
  return { version: 1, workflows: [] };
}

export async function readWorkflowStore(storePath: string): Promise<WorkflowStoreFile> {
  try {
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as WorkflowStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.workflows)) {
      return emptyStore();
    }
    return parsed;
  } catch {
    return emptyStore();
  }
}

export async function writeWorkflowStore(
  storePath: string,
  store: WorkflowStoreFile,
): Promise<void> {
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

export async function appendWorkflowEvent(storePath: string, event: WorkflowEvent): Promise<void> {
  const eventsDir = resolveWorkflowEventsDir(storePath);
  if (!existsSync(eventsDir)) {
    mkdirSync(eventsDir, { recursive: true });
  }
  const logPath = resolveWorkflowEventLogPath(storePath, event.workflowId);
  const line = JSON.stringify(event) + "\n";
  await fs.appendFile(logPath, line, "utf-8");
}

export async function readWorkflowEvents(
  storePath: string,
  workflowId: string,
  opts?: { limit?: number },
): Promise<WorkflowEvent[]> {
  const logPath = resolveWorkflowEventLogPath(storePath, workflowId);
  try {
    const raw = await fs.readFile(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const events: WorkflowEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as WorkflowEvent);
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
// Policies persistence
// ---------------------------------------------------------------------------

export async function readWorkflowPolicies(storePath: string): Promise<WorkflowPolicies> {
  const policiesPath = resolveWorkflowPoliciesPath(storePath);
  try {
    const raw = await fs.readFile(policiesPath, "utf-8");
    const parsed = JSON.parse(raw) as WorkflowPolicies;
    // Merge with defaults to handle missing fields after upgrades
    const defaults = defaultPolicies();
    return {
      branchPrefixes: { ...defaults.branchPrefixes, ...parsed.branchPrefixes },
      pr: { ...defaults.pr, ...parsed.pr },
      sessions: { ...defaults.sessions, ...parsed.sessions },
      commits: { ...defaults.commits, ...parsed.commits },
      safety: { ...defaults.safety, ...parsed.safety },
    };
  } catch {
    return defaultPolicies();
  }
}

export async function writeWorkflowPolicies(
  storePath: string,
  policies: WorkflowPolicies,
): Promise<void> {
  const policiesPath = resolveWorkflowPoliciesPath(storePath);
  const dir = path.dirname(policiesPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = policiesPath + ".tmp";
  const content = JSON.stringify(policies, null, 2);
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, policiesPath);
}

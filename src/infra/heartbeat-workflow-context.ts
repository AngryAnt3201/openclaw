// ---------------------------------------------------------------------------
// Heartbeat Workflow Context – provides active workflow summaries for the
// heartbeat prompt. Follows heartbeat-task-context.ts pattern.
// ---------------------------------------------------------------------------

import type { Workflow, WorkflowStatus } from "../workflow/types.js";
import { readWorkflowStore } from "../workflow/store.js";

const ACTIVE_STATUSES: Set<WorkflowStatus> = new Set([
  "planning",
  "running",
  "paused",
  "reviewing",
  "pr_open",
]);

const MAX_WORKFLOW_SUMMARY_LINES = 8;

export interface WorkflowContextSnapshot {
  /** Formatted text for the agent system prompt (null if no active workflows). */
  contextText: string | null;
  /** Number of active workflows. */
  count: number;
}

function formatStepProgress(wf: Workflow): string {
  const total = wf.steps.length;
  if (total === 0) {
    return "no steps";
  }
  const complete = wf.steps.filter((s) => s.status === "complete").length;
  const running = wf.steps.filter((s) => s.status === "running").length;
  const failed = wf.steps.filter((s) => s.status === "failed").length;
  const parts: string[] = [`${complete}/${total} done`];
  if (running > 0) {
    parts.push(`${running} running`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  return parts.join(", ");
}

function formatWorkflowLine(wf: Workflow, index: number): string {
  const status = wf.status.replace(/_/g, " ");
  const steps = formatStepProgress(wf);
  let line = `- {ref:${index}} "${wf.title}" (${status}, ${steps})`;
  if (wf.pullRequest) {
    line += ` PR #${wf.pullRequest.number}`;
  }
  if (wf.repo) {
    line += ` [${wf.repo.owner}/${wf.repo.name}]`;
  }
  return line;
}

/**
 * Build context text and ref count from the workflow store.
 */
export async function resolveWorkflowContextSnapshot(
  workflowStorePath: string | undefined,
): Promise<WorkflowContextSnapshot> {
  if (!workflowStorePath) {
    return { contextText: null, count: 0 };
  }

  try {
    const store = await readWorkflowStore(workflowStorePath);
    const active = store.workflows
      .filter((w) => ACTIVE_STATUSES.has(w.status))
      .toSorted((a, b) => a.createdAtMs - b.createdAtMs);

    if (active.length === 0) {
      return { contextText: null, count: 0 };
    }

    const limited = active.slice(0, MAX_WORKFLOW_SUMMARY_LINES);

    const lines = limited.map((wf, i) => formatWorkflowLine(wf, i));

    const overflow =
      active.length > MAX_WORKFLOW_SUMMARY_LINES
        ? `\n(${active.length - MAX_WORKFLOW_SUMMARY_LINES} more workflows not shown)`
        : "";

    const footer =
      "\n\nUse workflow tool actions to manage workflows. " +
      "Use github tool for PR/issue operations.";

    const contextText = `\n\nActive workflows (${active.length}):\n${lines.join("\n")}${overflow}${footer}`;

    return { contextText, count: active.length };
  } catch {
    return { contextText: null, count: 0 };
  }
}

/**
 * Read the workflow store and return formatted summary text.
 * Returns `null` if no workflows are active.
 */
export async function resolveWorkflowContextForHeartbeat(
  workflowStorePath: string | undefined,
): Promise<string | null> {
  const snapshot = await resolveWorkflowContextSnapshot(workflowStorePath);
  return snapshot.contextText;
}

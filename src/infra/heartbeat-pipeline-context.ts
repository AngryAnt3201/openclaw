// ---------------------------------------------------------------------------
// Heartbeat Pipeline Context – provides active pipeline summaries for heartbeat
// ---------------------------------------------------------------------------
// Reads the pipeline store and recent run history so the heartbeat agent has
// visibility into active automations, currently-running executions, and recent
// failures.
// ---------------------------------------------------------------------------

import type {
  Pipeline,
  PipelineRun,
  PipelineRunStatus,
  PipelineStatus,
} from "../pipeline/types.js";
import { loadPipelineRuns } from "../pipeline/run-log.js";
import { loadPipelineStore } from "../pipeline/store.js";

/** Pipeline statuses considered "live" (not draft/archived). */
const LIVE_STATUSES: Set<PipelineStatus> = new Set(["active", "paused", "error"]);

/** Run statuses considered "in-flight". */
const ACTIVE_RUN_STATUSES: Set<PipelineRunStatus> = new Set(["pending", "running"]);

const MAX_PIPELINE_LINES = 10;
const MAX_RECENT_RUNS_PER_PIPELINE = 3;

function formatPipelineLine(
  pipeline: Pipeline,
  activeRuns: PipelineRun[],
  recentRuns: PipelineRun[],
): string {
  const status = pipeline.status;
  const enabled = pipeline.enabled ? "enabled" : "disabled";
  let line = `- "${pipeline.name}" (${status}, ${enabled}, ${pipeline.nodes.length} nodes, ${pipeline.runCount} runs)`;

  if (activeRuns.length > 0) {
    const runDescs = activeRuns.map((r) => {
      const elapsed = Date.now() - r.startedAtMs;
      return `${r.status} via ${r.trigger} (${formatDuration(elapsed)})`;
    });
    line += `\n  Active: ${runDescs.join("; ")}`;
  }

  const failedRuns = recentRuns.filter((r) => r.status === "failed");
  if (failedRuns.length > 0) {
    const errors = failedRuns.slice(0, 2).map((r) => r.error ?? "unknown error");
    line += `\n  Recent failures: ${errors.join("; ")}`;
  }

  return line;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Read the pipeline store and recent runs, returning a formatted summary of
 * active pipelines for the heartbeat prompt.
 *
 * Returns `null` if no live pipelines exist or the store cannot be read.
 */
export async function resolvePipelineContextForHeartbeat(
  pipelineStorePath: string | undefined,
): Promise<string | null> {
  if (!pipelineStorePath) {
    return null;
  }

  try {
    const store = await loadPipelineStore(pipelineStorePath);

    const livePipelines = store.pipelines.filter((p) => LIVE_STATUSES.has(p.status));

    if (livePipelines.length === 0) {
      return null;
    }

    const limited = livePipelines.slice(0, MAX_PIPELINE_LINES);

    // Load recent runs for each pipeline to detect in-flight and failed runs.
    const lines: string[] = [];
    let totalActiveRuns = 0;

    for (const pipeline of limited) {
      const runs = await loadPipelineRuns(
        pipelineStorePath,
        pipeline.id,
        MAX_RECENT_RUNS_PER_PIPELINE,
      );
      const activeRuns = runs.filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
      totalActiveRuns += activeRuns.length;
      lines.push(formatPipelineLine(pipeline, activeRuns, runs));
    }

    const overflow =
      livePipelines.length > MAX_PIPELINE_LINES
        ? `\n(${livePipelines.length - MAX_PIPELINE_LINES} more pipelines not shown)`
        : "";

    const runSummary = totalActiveRuns > 0 ? `, ${totalActiveRuns} currently running` : "";

    const footer =
      "\n\nUse the pipeline tool to view, create, or update automations. " +
      "If a pipeline is in error state, investigate and fix. " +
      "If a run is failing repeatedly, alert the user.";

    return `\n\nActive pipelines (${livePipelines.length}${runSummary}):\n${lines.join("\n")}${overflow}${footer}`;
  } catch {
    return null;
  }
}

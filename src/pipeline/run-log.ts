// ---------------------------------------------------------------------------
// Pipeline Run Log – Persistence for pipeline execution history
// ---------------------------------------------------------------------------
// Each run is stored as an individual JSON file under:
//   {storeDir}/runs/{pipelineId}/{runId}.json
//
// This approach avoids the growing-array problem of a single store file and
// keeps per-pipeline history easily purgeable.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { PipelineRun } from "./types.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Directory where runs for a specific pipeline are stored.
 * `storePath` is the path to the main pipeline `store.json`.
 */
function runsDir(storePath: string, pipelineId: string): string {
  return path.join(path.dirname(storePath), "runs", pipelineId);
}

function runFilePath(storePath: string, run: PipelineRun): string {
  return path.join(runsDir(storePath, run.pipelineId), `${run.id}.json`);
}

// ---------------------------------------------------------------------------
// appendPipelineRun
// ---------------------------------------------------------------------------

let writeSeq = 0;

/**
 * Persist a pipeline run to disk. Creates the runs directory if missing.
 * Uses atomic write (tmp + rename) for crash safety.
 */
export async function appendPipelineRun(storePath: string, run: PipelineRun): Promise<void> {
  const dir = runsDir(storePath, run.pipelineId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = runFilePath(storePath, run);
  const tmp = filePath + ".tmp." + process.pid + "." + writeSeq++;
  const content = JSON.stringify(run, null, 2);

  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

// ---------------------------------------------------------------------------
// loadPipelineRuns
// ---------------------------------------------------------------------------

/**
 * Load all runs for a given pipeline, sorted newest-first by `startedAtMs`.
 * Returns an empty array when the pipeline has no runs or the directory is
 * missing.
 */
export async function loadPipelineRuns(
  storePath: string,
  pipelineId: string,
  limit?: number,
): Promise<PipelineRun[]> {
  const dir = runsDir(storePath, pipelineId);

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // Directory doesn't exist — no runs yet.
    return [];
  }

  const jsonFiles = entries.filter((f) => f.endsWith(".json"));

  const runs: PipelineRun[] = [];
  for (const file of jsonFiles) {
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf-8");
      const run = JSON.parse(raw) as PipelineRun;
      runs.push(run);
    } catch {
      // Skip malformed files.
    }
  }

  // Sort newest-first.
  runs.sort((a, b) => b.startedAtMs - a.startedAtMs);

  if (limit !== undefined && limit > 0) {
    return runs.slice(0, limit);
  }

  return runs;
}

// ---------------------------------------------------------------------------
// loadPipelineRun (single)
// ---------------------------------------------------------------------------

/**
 * Load a single run by ID. Returns `null` when not found.
 */
export async function loadPipelineRun(
  storePath: string,
  pipelineId: string,
  runId: string,
): Promise<PipelineRun | null> {
  const filePath = path.join(runsDir(storePath, pipelineId), `${runId}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as PipelineRun;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pipeline Run Log – Tests
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PipelineRun } from "./types.js";
import { appendPipelineRun, loadPipelineRun, loadPipelineRuns } from "./run-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let storePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-run-log-"));
  storePath = path.join(tmpDir, "store.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeRun(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    pipelineId: "pipeline-1",
    status: "success",
    trigger: "manual",
    nodeResults: [],
    startedAtMs: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("appendPipelineRun + loadPipelineRuns", () => {
  it("appends and loads a single run", async () => {
    const run = makeRun({ id: "run-1", pipelineId: "p1" });
    await appendPipelineRun(storePath, run);

    const runs = await loadPipelineRuns(storePath, "p1");
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("run-1");
    expect(runs[0].pipelineId).toBe("p1");
    expect(runs[0].status).toBe("success");
  });

  it("loads multiple runs sorted newest-first", async () => {
    const run1 = makeRun({ id: "run-1", pipelineId: "p1", startedAtMs: 1000 });
    const run2 = makeRun({ id: "run-2", pipelineId: "p1", startedAtMs: 3000 });
    const run3 = makeRun({ id: "run-3", pipelineId: "p1", startedAtMs: 2000 });

    await appendPipelineRun(storePath, run1);
    await appendPipelineRun(storePath, run2);
    await appendPipelineRun(storePath, run3);

    const runs = await loadPipelineRuns(storePath, "p1");
    expect(runs).toHaveLength(3);
    expect(runs[0].id).toBe("run-2"); // newest (3000)
    expect(runs[1].id).toBe("run-3"); // middle (2000)
    expect(runs[2].id).toBe("run-1"); // oldest (1000)
  });

  it("respects limit parameter", async () => {
    const run1 = makeRun({ id: "run-1", pipelineId: "p1", startedAtMs: 1000 });
    const run2 = makeRun({ id: "run-2", pipelineId: "p1", startedAtMs: 3000 });
    const run3 = makeRun({ id: "run-3", pipelineId: "p1", startedAtMs: 2000 });

    await appendPipelineRun(storePath, run1);
    await appendPipelineRun(storePath, run2);
    await appendPipelineRun(storePath, run3);

    const runs = await loadPipelineRuns(storePath, "p1", 2);
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe("run-2"); // newest
    expect(runs[1].id).toBe("run-3"); // second newest
  });

  it("returns empty array for nonexistent pipeline", async () => {
    const runs = await loadPipelineRuns(storePath, "nonexistent");
    expect(runs).toEqual([]);
  });

  it("handles missing directory gracefully", async () => {
    // storePath points to a directory that doesn't exist yet
    const badPath = path.join(tmpDir, "does", "not", "exist", "store.json");
    const runs = await loadPipelineRuns(badPath, "p1");
    expect(runs).toEqual([]);
  });

  it("isolates runs by pipeline ID", async () => {
    const runA = makeRun({ id: "run-a", pipelineId: "alpha", startedAtMs: 1000 });
    const runB = makeRun({ id: "run-b", pipelineId: "beta", startedAtMs: 2000 });

    await appendPipelineRun(storePath, runA);
    await appendPipelineRun(storePath, runB);

    const alphaRuns = await loadPipelineRuns(storePath, "alpha");
    expect(alphaRuns).toHaveLength(1);
    expect(alphaRuns[0].id).toBe("run-a");

    const betaRuns = await loadPipelineRuns(storePath, "beta");
    expect(betaRuns).toHaveLength(1);
    expect(betaRuns[0].id).toBe("run-b");
  });

  it("preserves full run data including nodeResults", async () => {
    const run = makeRun({
      id: "run-detailed",
      pipelineId: "p1",
      status: "failed",
      trigger: "cron",
      triggerData: { schedule: "*/5 * * * *" },
      nodeResults: [
        {
          nodeId: "node-1",
          status: "success",
          startedAtMs: 1000,
          completedAtMs: 2000,
          output: { data: "hello" },
        },
        {
          nodeId: "node-2",
          status: "failed",
          startedAtMs: 2000,
          completedAtMs: 3000,
          error: "Something went wrong",
        },
      ],
      startedAtMs: 1000,
      completedAtMs: 3000,
      error: "Node node-2 failed",
    });

    await appendPipelineRun(storePath, run);

    const runs = await loadPipelineRuns(storePath, "p1");
    expect(runs).toHaveLength(1);

    const loaded = runs[0];
    expect(loaded.status).toBe("failed");
    expect(loaded.trigger).toBe("cron");
    expect(loaded.triggerData).toEqual({ schedule: "*/5 * * * *" });
    expect(loaded.nodeResults).toHaveLength(2);
    expect(loaded.nodeResults[0].output).toEqual({ data: "hello" });
    expect(loaded.nodeResults[1].error).toBe("Something went wrong");
    expect(loaded.completedAtMs).toBe(3000);
    expect(loaded.error).toBe("Node node-2 failed");
  });
});

describe("loadPipelineRun (single)", () => {
  it("loads a single run by ID", async () => {
    const run = makeRun({ id: "run-single", pipelineId: "p1" });
    await appendPipelineRun(storePath, run);

    const loaded = await loadPipelineRun(storePath, "p1", "run-single");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("run-single");
  });

  it("returns null for nonexistent run", async () => {
    const loaded = await loadPipelineRun(storePath, "p1", "missing");
    expect(loaded).toBeNull();
  });
});

describe("overwrite existing run", () => {
  it("overwrites a run with the same ID", async () => {
    const run1 = makeRun({
      id: "run-1",
      pipelineId: "p1",
      status: "running",
      startedAtMs: 1000,
    });
    await appendPipelineRun(storePath, run1);

    const run1Updated = makeRun({
      id: "run-1",
      pipelineId: "p1",
      status: "success",
      startedAtMs: 1000,
      completedAtMs: 5000,
    });
    await appendPipelineRun(storePath, run1Updated);

    const runs = await loadPipelineRuns(storePath, "p1");
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("success");
    expect(runs[0].completedAtMs).toBe(5000);
  });
});

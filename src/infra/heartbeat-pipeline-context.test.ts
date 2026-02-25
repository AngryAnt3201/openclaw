import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pipeline, PipelineRun, PipelineStoreFile } from "../pipeline/types.js";
import { appendPipelineRun } from "../pipeline/run-log.js";
import { savePipelineStore } from "../pipeline/store.js";
import { resolvePipelineContextForHeartbeat } from "./heartbeat-pipeline-context.js";

let tmpDir: string;
let storePath: string;

function makePipeline(overrides: Partial<Pipeline> & { id: string; name: string }): Pipeline {
  return {
    description: "",
    enabled: true,
    nodes: [],
    edges: [],
    status: "active",
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    runCount: 0,
    ...overrides,
  };
}

function makeRun(
  overrides: Partial<PipelineRun> & { id: string; pipelineId: string },
): PipelineRun {
  return {
    status: "success",
    trigger: "manual",
    nodeResults: [],
    startedAtMs: Date.now(),
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "heartbeat-pipeline-ctx-"));
  storePath = path.join(tmpDir, "store.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolvePipelineContextForHeartbeat", () => {
  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("returns null when pipelineStorePath is undefined", async () => {
    expect(await resolvePipelineContextForHeartbeat(undefined)).toBeNull();
  });

  it("returns null when store does not exist", async () => {
    const result = await resolvePipelineContextForHeartbeat(path.join(tmpDir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("returns null when store is empty", async () => {
    const store: PipelineStoreFile = { version: 1, pipelines: [] };
    await savePipelineStore(storePath, store);
    expect(await resolvePipelineContextForHeartbeat(storePath)).toBeNull();
  });

  it("returns null when all pipelines are draft or archived", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [
        makePipeline({ id: "p1", name: "Draft pipeline", status: "draft" }),
        makePipeline({ id: "p2", name: "Archived pipeline", status: "archived" }),
      ],
    };
    await savePipelineStore(storePath, store);
    expect(await resolvePipelineContextForHeartbeat(storePath)).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Active pipeline detection
  // -----------------------------------------------------------------------

  it("includes active pipelines", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [makePipeline({ id: "p1", name: "My Automation", status: "active" })],
    };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).not.toBeNull();
    expect(result).toContain("My Automation");
    expect(result).toContain("active");
    expect(result).toContain("Active pipelines (1)");
  });

  it("includes paused pipelines", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [makePipeline({ id: "p1", name: "Paused Flow", status: "paused" })],
    };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("Paused Flow");
    expect(result).toContain("paused");
  });

  it("includes error-state pipelines", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [makePipeline({ id: "p1", name: "Broken Flow", status: "error" })],
    };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("Broken Flow");
    expect(result).toContain("error");
  });

  // -----------------------------------------------------------------------
  // Filtering
  // -----------------------------------------------------------------------

  it("excludes draft and archived pipelines", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [
        makePipeline({ id: "p1", name: "Active One", status: "active" }),
        makePipeline({ id: "p2", name: "Draft One", status: "draft" }),
        makePipeline({ id: "p3", name: "Archived One", status: "archived" }),
      ],
    };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("Active One");
    expect(result).not.toContain("Draft One");
    expect(result).not.toContain("Archived One");
    expect(result).toContain("Active pipelines (1)");
  });

  // -----------------------------------------------------------------------
  // Formatting
  // -----------------------------------------------------------------------

  it("includes node count and run count", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [
        makePipeline({
          id: "p1",
          name: "Complex Pipeline",
          status: "active",
          nodes: [
            {
              id: "n1",
              type: "cron",
              label: "Trigger",
              config: { kind: "manual" } as never,
              position: { x: 0, y: 0 },
              state: { status: "idle", retryCount: 0 },
            },
            {
              id: "n2",
              type: "agent",
              label: "Process",
              config: { kind: "agent", prompt: "" } as never,
              position: { x: 0, y: 0 },
              state: { status: "idle", retryCount: 0 },
            },
          ],
          runCount: 42,
        }),
      ],
    };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("2 nodes");
    expect(result).toContain("42 runs");
  });

  it("shows enabled/disabled status", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [
        makePipeline({ id: "p1", name: "Enabled Flow", status: "active", enabled: true }),
        makePipeline({ id: "p2", name: "Disabled Flow", status: "active", enabled: false }),
      ],
    };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("enabled");
    expect(result).toContain("disabled");
  });

  it("includes pipeline tool instructions", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [makePipeline({ id: "p1", name: "Flow", status: "active" })],
    };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("pipeline tool");
  });

  // -----------------------------------------------------------------------
  // Multiple pipelines
  // -----------------------------------------------------------------------

  it("lists multiple live pipelines", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [
        makePipeline({ id: "p1", name: "Flow A", status: "active" }),
        makePipeline({ id: "p2", name: "Flow B", status: "paused" }),
        makePipeline({ id: "p3", name: "Flow C", status: "error" }),
      ],
    };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("Active pipelines (3)");
    expect(result).toContain("Flow A");
    expect(result).toContain("Flow B");
    expect(result).toContain("Flow C");
  });

  // -----------------------------------------------------------------------
  // Overflow truncation (max 10)
  // -----------------------------------------------------------------------

  it("truncates to 10 pipelines and shows overflow count", async () => {
    const pipelines: Pipeline[] = [];
    for (let i = 0; i < 15; i++) {
      pipelines.push(makePipeline({ id: `p${i}`, name: `Pipeline ${i}`, status: "active" }));
    }
    const store: PipelineStoreFile = { version: 1, pipelines };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("Active pipelines (15)");
    expect(result).toContain("Pipeline 0");
    expect(result).toContain("Pipeline 9");
    expect(result).not.toContain("Pipeline 10");
    expect(result).toContain("5 more pipelines not shown");
  });

  it("does not show overflow for exactly 10 pipelines", async () => {
    const pipelines: Pipeline[] = [];
    for (let i = 0; i < 10; i++) {
      pipelines.push(makePipeline({ id: `p${i}`, name: `Pipeline ${i}`, status: "active" }));
    }
    const store: PipelineStoreFile = { version: 1, pipelines };
    await savePipelineStore(storePath, store);
    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("Active pipelines (10)");
    expect(result).not.toContain("more pipelines not shown");
  });

  // -----------------------------------------------------------------------
  // Run integration
  // -----------------------------------------------------------------------

  it("shows active runs for a pipeline", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [makePipeline({ id: "p1", name: "Running Flow", status: "active" })],
    };
    await savePipelineStore(storePath, store);
    await appendPipelineRun(
      storePath,
      makeRun({
        id: "r1",
        pipelineId: "p1",
        status: "running",
        trigger: "cron",
        startedAtMs: Date.now() - 30_000,
      }),
    );

    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("Active:");
    expect(result).toContain("running via cron");
    expect(result).toContain("1 currently running");
  });

  it("shows recent failures", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [makePipeline({ id: "p1", name: "Failing Flow", status: "error" })],
    };
    await savePipelineStore(storePath, store);
    await appendPipelineRun(
      storePath,
      makeRun({
        id: "r1",
        pipelineId: "p1",
        status: "failed",
        error: "API timeout",
        startedAtMs: Date.now() - 60_000,
      }),
    );

    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).toContain("Recent failures:");
    expect(result).toContain("API timeout");
  });

  it("does not show failures for successful pipelines", async () => {
    const store: PipelineStoreFile = {
      version: 1,
      pipelines: [makePipeline({ id: "p1", name: "Happy Flow", status: "active" })],
    };
    await savePipelineStore(storePath, store);
    await appendPipelineRun(
      storePath,
      makeRun({
        id: "r1",
        pipelineId: "p1",
        status: "success",
        startedAtMs: Date.now() - 60_000,
      }),
    );

    const result = await resolvePipelineContextForHeartbeat(storePath);
    expect(result).not.toContain("Recent failures:");
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("returns null for corrupt store file", async () => {
    await fs.writeFile(storePath, "not json at all");
    expect(await resolvePipelineContextForHeartbeat(storePath)).toBeNull();
  });
});

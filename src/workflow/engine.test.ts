import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow, WorkflowCreateInput } from "./types.js";
import { WorkflowEngine, type WorkflowEngineDeps } from "./engine.js";
import { WorkflowService } from "./service.js";

// Mock github module
vi.mock("./github.js", () => ({
  resolveRepoContext: vi.fn().mockResolvedValue({
    path: "/tmp/test-repo",
    remote: "origin",
    remoteUrl: "https://github.com/test/repo.git",
    owner: "test",
    name: "repo",
  }),
  getCurrentBranch: vi.fn().mockResolvedValue("main"),
  getCommitLog: vi.fn().mockResolvedValue([]),
  getDiffStat: vi.fn().mockResolvedValue([]),
  pushBranch: vi.fn().mockResolvedValue(undefined),
  createPR: vi.fn().mockResolvedValue({
    number: 1,
    url: "https://github.com/test/repo/pull/1",
    title: "Test",
    body: "",
    state: "draft",
    headBranch: "feat/test",
    baseBranch: "main",
    additions: 0,
    deletions: 0,
    filesChanged: 0,
    checks: [],
    createdAtMs: 1000,
    updatedAtMs: 1000,
  }),
}));

async function makeTmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-wf-engine-"));
  return {
    dir,
    storePath: path.join(dir, "store.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function makeEngine(service: WorkflowService, overrides?: Partial<WorkflowEngineDeps>) {
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  const spawnCalls: Array<{ sessionKey: string; message: string }> = [];
  const sessionDone = new Map<string, { done: boolean; success?: boolean; output?: string }>();

  const deps: WorkflowEngineDeps = {
    workflowService: service,
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    spawnSession: vi.fn().mockImplementation(async (params) => {
      spawnCalls.push(params);
      const runId = `run-${spawnCalls.length}`;
      sessionDone.set(runId, { done: false });
      return { runId };
    }),
    checkSessionStatus: vi.fn().mockImplementation(async (runId) => {
      return sessionDone.get(runId) ?? { done: false };
    }),
    broadcast: (event, payload) => {
      broadcasts.push({ event, payload });
    },
    ...overrides,
  };

  const engine = new WorkflowEngine(deps);
  return { engine, broadcasts, spawnCalls, sessionDone, deps };
}

function makeService(storePath: string) {
  return new WorkflowService({
    storePath,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcast: vi.fn(),
  });
}

const baseInput: WorkflowCreateInput = {
  title: "Test Workflow",
  description: "desc",
  trigger: "manual",
  repoPath: "/tmp/test-repo",
};

// ---------------------------------------------------------------------------
// Dependency resolution
// ---------------------------------------------------------------------------

describe("WorkflowEngine.findReadySteps", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;
  let service: WorkflowService;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
    service = makeService(storePath);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns steps with no dependencies", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [
        { title: "S1", description: "d" },
        { title: "S2", description: "d" },
      ],
    });

    const { engine } = makeEngine(service);
    const ready = engine.findReadySteps(wf);
    expect(ready).toHaveLength(2);
  });

  it("blocks steps whose dependencies are not complete", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [
        { title: "S1", description: "d" },
        { title: "S2", description: "d", dependsOn: [0] },
      ],
    });

    const { engine } = makeEngine(service);
    const ready = engine.findReadySteps(wf);
    // Only S1 is ready, S2 depends on S1
    expect(ready).toHaveLength(1);
    expect(ready[0]!.title).toBe("S1");
  });

  it("unblocks step when dependency is complete", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [
        { title: "S1", description: "d" },
        { title: "S2", description: "d", dependsOn: [0] },
      ],
    });

    // Complete S1
    await service.updateStep(wf.id, wf.steps[0]!.id, { status: "complete" });
    const updated = await service.get(wf.id);

    const { engine } = makeEngine(service);
    const ready = engine.findReadySteps(updated!);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.title).toBe("S2");
  });

  it("treats skipped dependencies as satisfied", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [
        { title: "S1", description: "d" },
        { title: "S2", description: "d", dependsOn: [0] },
      ],
    });

    await service.updateStep(wf.id, wf.steps[0]!.id, { status: "skipped" });
    const updated = await service.get(wf.id);

    const { engine } = makeEngine(service);
    const ready = engine.findReadySteps(updated!);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.title).toBe("S2");
  });

  it("skips already running steps", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [{ title: "S1", description: "d" }],
    });

    await service.updateStep(wf.id, wf.steps[0]!.id, { status: "running" });
    const updated = await service.get(wf.id);

    const { engine } = makeEngine(service);
    const ready = engine.findReadySteps(updated!);
    expect(ready).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Session spawning via tick
// ---------------------------------------------------------------------------

describe("WorkflowEngine.tick", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;
  let service: WorkflowService;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
    service = makeService(storePath);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("spawns sessions for ready steps", async () => {
    await service.create({
      ...baseInput,
      steps: [{ title: "S1", description: "Do something" }],
    });

    const { engine, spawnCalls } = makeEngine(service);
    await engine.tick();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.message).toContain("Do something");
  });

  it("respects maxConcurrent policy", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [
        { title: "S1", description: "d" },
        { title: "S2", description: "d" },
        { title: "S3", description: "d" },
      ],
    });

    // Set maxConcurrent to 1
    await service.updatePolicies({
      sessions: {
        maxConcurrent: 1,
        maxTokensPerStep: 200_000,
        maxTokensPerWorkflow: 1_000_000,
        timeoutMs: 600_000,
        allowedModes: ["Claude"],
      },
    });

    const { engine, spawnCalls } = makeEngine(service);
    await engine.tick();

    // Only 1 session should be spawned due to concurrency limit
    expect(spawnCalls).toHaveLength(1);
  });

  it("marks step as running when session spawned", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [{ title: "S1", description: "d" }],
    });

    const { engine } = makeEngine(service);
    await engine.tick();

    const updated = await service.get(wf.id);
    expect(updated!.steps[0]!.status).toBe("running");
  });

  it("does nothing when workflow is paused", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [{ title: "S1", description: "d" }],
    });
    await service.pause(wf.id);

    const { engine, spawnCalls } = makeEngine(service);
    await engine.tick();

    expect(spawnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Session completion
// ---------------------------------------------------------------------------

describe("WorkflowEngine session completion", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;
  let service: WorkflowService;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
    service = makeService(storePath);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("marks step as complete when session succeeds", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [{ title: "S1", description: "d" }],
    });

    let time = 0;
    const { engine, sessionDone } = makeEngine(service, { nowMs: () => time });
    time = 0;
    await engine.tick(); // Spawn session

    // Mark session as done
    const activeSessions = engine.getActiveSessions();
    const session = Array.from(activeSessions.values())[0]!;
    sessionDone.set(session.runId, { done: true, success: true, output: "Done!" });

    time = 10_000; // Advance past poll interval
    await engine.tick(); // Poll and process completion

    const updated = await service.get(wf.id);
    expect(updated!.steps[0]!.status).toBe("complete");
    expect(updated!.steps[0]!.result).toBe("Done!");
  });

  it("marks step as failed when session fails", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [{ title: "S1", description: "d" }],
    });

    let time = 0;
    const { engine, sessionDone } = makeEngine(service, { nowMs: () => time });
    time = 0;
    await engine.tick();

    const session = Array.from(engine.getActiveSessions().values())[0]!;
    sessionDone.set(session.runId, { done: true, success: false, output: "Error!" });

    time = 10_000;
    await engine.tick();

    const updated = await service.get(wf.id);
    expect(updated!.steps[0]!.status).toBe("failed");
  });

  it("creates PR when all steps complete", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [{ title: "S1", description: "d" }],
    });

    let time = 0;
    const { engine, sessionDone, broadcasts } = makeEngine(service, { nowMs: () => time });
    time = 0;
    await engine.tick();

    const session = Array.from(engine.getActiveSessions().values())[0]!;
    sessionDone.set(session.runId, { done: true, success: true });

    time = 10_000;
    await engine.tick(); // Complete step
    time = 20_000;
    await engine.tick(); // Trigger PR creation

    const updated = await service.get(wf.id);
    expect(updated!.status).toBe("pr_open");
    expect(updated!.pullRequest).toBeTruthy();
    expect(broadcasts.some((b) => b.event === "workflow.pr_created")).toBe(true);
  });

  it("triggers next steps after dependency completes", async () => {
    const wf = await service.create({
      ...baseInput,
      steps: [
        { title: "S1", description: "d" },
        { title: "S2", description: "d", dependsOn: [0] },
      ],
    });

    let time = 0;
    const { engine, sessionDone, spawnCalls } = makeEngine(service, { nowMs: () => time });

    // First tick: spawn S1
    time = 0;
    await engine.tick();
    expect(spawnCalls).toHaveLength(1);

    // Complete S1
    const session = Array.from(engine.getActiveSessions().values())[0]!;
    sessionDone.set(session.runId, { done: true, success: true });
    time = 10_000;
    await engine.tick(); // Process S1 completion

    // Next tick: spawn S2
    time = 20_000;
    await engine.tick();
    expect(spawnCalls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Session timeout
// ---------------------------------------------------------------------------

describe("WorkflowEngine timeout", () => {
  it("fails step when session times out", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const service = makeService(storePath);
      const wf = await service.create({
        ...baseInput,
        steps: [{ title: "S1", description: "d" }],
      });

      // Set very low timeout
      await service.updatePolicies({
        sessions: {
          maxConcurrent: 2,
          maxTokensPerStep: 200_000,
          maxTokensPerWorkflow: 1_000_000,
          timeoutMs: 100, // 100ms timeout
          allowedModes: ["Claude"],
        },
      });

      let time = 0;
      const { engine } = makeEngine(service, { nowMs: () => time });

      time = 0;
      await engine.tick(); // Spawn

      time = 200; // Advance past timeout
      await engine.tick(); // Should detect timeout

      const updated = await service.get(wf.id);
      expect(updated!.steps[0]!.status).toBe("failed");
      expect(updated!.steps[0]!.error).toContain("timed out");
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

describe("WorkflowEngine start/stop", () => {
  it("can be started and stopped", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const service = makeService(storePath);
      const { engine } = makeEngine(service);

      engine.start();
      engine.stop();
      // Should not throw
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("WorkflowEngine error handling", () => {
  it("marks step as failed when spawn throws", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const service = makeService(storePath);
      const wf = await service.create({
        ...baseInput,
        steps: [{ title: "S1", description: "d" }],
      });

      const { engine } = makeEngine(service, {
        spawnSession: vi.fn().mockRejectedValue(new Error("spawn failed")),
      });

      await engine.tick();

      const updated = await service.get(wf.id);
      expect(updated!.steps[0]!.status).toBe("failed");
      expect(updated!.steps[0]!.error).toContain("spawn failed");
    } finally {
      await cleanup();
    }
  });
});

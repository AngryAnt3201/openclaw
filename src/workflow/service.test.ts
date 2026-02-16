import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow, WorkflowCreateInput } from "./types.js";
import { WorkflowService, type WorkflowServiceDeps } from "./service.js";

// Mock github module to avoid requiring actual git repos
vi.mock("./github.js", () => ({
  resolveRepoContext: vi.fn().mockResolvedValue({
    path: "/tmp/test-repo",
    remote: "origin",
    remoteUrl: "https://github.com/test/repo.git",
    owner: "test",
    name: "repo",
  }),
  getCurrentBranch: vi.fn().mockResolvedValue("main"),
}));

async function makeTmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-wf-svc-"));
  return {
    dir,
    storePath: path.join(dir, "store.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function makeService(storePath: string, nowMs?: () => number) {
  const events: Array<{ event: string; payload: unknown }> = [];
  const logs: string[] = [];

  const deps: WorkflowServiceDeps = {
    storePath,
    log: {
      info: (msg) => logs.push(`INFO: ${msg}`),
      warn: (msg) => logs.push(`WARN: ${msg}`),
      error: (msg) => logs.push(`ERROR: ${msg}`),
    },
    broadcast: (event, payload) => {
      events.push({ event, payload });
    },
    nowMs,
  };

  return { service: new WorkflowService(deps), events, logs };
}

const baseInput: WorkflowCreateInput = {
  title: "Test Workflow",
  description: "Test description",
  trigger: "manual",
  repoPath: "/tmp/test-repo",
};

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("WorkflowService.create", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates a workflow with planning status when no steps given", async () => {
    const { service } = makeService(storePath);
    const wf = await service.create(baseInput);

    expect(wf.id).toBeTruthy();
    expect(wf.title).toBe("Test Workflow");
    expect(wf.status).toBe("planning");
    expect(wf.steps).toHaveLength(0);
    expect(wf.repo.owner).toBe("test");
    expect(wf.repo.name).toBe("repo");
    expect(wf.baseBranch).toBe("main");
    expect(wf.workBranch).toContain("feat/");
  });

  it("creates a workflow with running status when steps are provided", async () => {
    const { service } = makeService(storePath);
    const wf = await service.create({
      ...baseInput,
      steps: [
        { title: "Step 1", description: "Do first thing" },
        { title: "Step 2", description: "Do second thing", dependsOn: [0] },
      ],
    });

    expect(wf.status).toBe("running");
    expect(wf.steps).toHaveLength(2);
    expect(wf.steps[0]!.status).toBe("pending");
    expect(wf.steps[1]!.dependsOn).toContain(wf.steps[0]!.id);
  });

  it("broadcasts workflow.created event", async () => {
    const { service, events } = makeService(storePath);
    await service.create(baseInput);

    expect(events.some((e) => e.event === "workflow.created")).toBe(true);
  });

  it("uses custom branch name when provided", async () => {
    const { service } = makeService(storePath);
    const wf = await service.create({
      ...baseInput,
      branchName: "custom/my-branch",
    });

    expect(wf.workBranch).toBe("custom/my-branch");
  });

  it("uses custom branch prefix", async () => {
    const { service } = makeService(storePath);
    const wf = await service.create({
      ...baseInput,
      branchPrefix: "fix/",
    });

    expect(wf.workBranch).toContain("fix/");
  });

  it("uses injected nowMs", async () => {
    const { service } = makeService(storePath, () => 42000);
    const wf = await service.create(baseInput);
    expect(wf.createdAtMs).toBe(42000);
    expect(wf.updatedAtMs).toBe(42000);
  });
});

// ---------------------------------------------------------------------------
// get / list
// ---------------------------------------------------------------------------

describe("WorkflowService.get", () => {
  it("returns workflow by ID", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create(baseInput);
      const found = await service.get(wf.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(wf.id);
    } finally {
      await cleanup();
    }
  });

  it("returns null for unknown ID", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const found = await service.get("nonexistent");
      expect(found).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

describe("WorkflowService.list", () => {
  it("returns all workflows without filter", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      await service.create(baseInput);
      await service.create({ ...baseInput, title: "Second" });
      const all = await service.list();
      expect(all).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });

  it("filters by status", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      await service.create(baseInput); // planning
      await service.create({
        ...baseInput,
        title: "Running",
        steps: [{ title: "S1", description: "d" }],
      }); // running
      const planning = await service.list({ status: ["planning"] });
      expect(planning).toHaveLength(1);
      expect(planning[0]!.status).toBe("planning");
    } finally {
      await cleanup();
    }
  });

  it("respects limit", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      await service.create(baseInput);
      await service.create({ ...baseInput, title: "Second" });
      await service.create({ ...baseInput, title: "Third" });
      const limited = await service.list({ limit: 2 });
      expect(limited).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// updateWorkflow
// ---------------------------------------------------------------------------

describe("WorkflowService.updateWorkflow", () => {
  it("updates workflow fields", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create(baseInput);
      const updated = await service.updateWorkflow(wf.id, {
        status: "running",
        startedAtMs: 5000,
      });
      expect(updated!.status).toBe("running");
      expect(updated!.startedAtMs).toBe(5000);
    } finally {
      await cleanup();
    }
  });

  it("broadcasts workflow.updated and specific events on status change", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service, events } = makeService(storePath);
      const wf = await service.create(baseInput);
      events.length = 0;

      await service.updateWorkflow(wf.id, { status: "failed" });
      expect(events.some((e) => e.event === "workflow.updated")).toBe(true);
      expect(events.some((e) => e.event === "workflow.failed")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("returns null for unknown workflow", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const result = await service.updateWorkflow("nope", { status: "running" });
      expect(result).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// updateStep
// ---------------------------------------------------------------------------

describe("WorkflowService.updateStep", () => {
  it("updates step fields", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create({
        ...baseInput,
        steps: [{ title: "Step", description: "Do thing" }],
      });
      const stepId = wf.steps[0]!.id;

      const updated = await service.updateStep(wf.id, stepId, {
        status: "running",
        startedAtMs: 3000,
      });
      expect(updated!.steps[0]!.status).toBe("running");
      expect(updated!.steps[0]!.startedAtMs).toBe(3000);
    } finally {
      await cleanup();
    }
  });

  it("returns null for unknown step", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create(baseInput);
      const result = await service.updateStep(wf.id, "nope", { status: "running" });
      expect(result).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// pause / resume / cancel
// ---------------------------------------------------------------------------

describe("WorkflowService lifecycle", () => {
  it("pause sets status to paused", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create({
        ...baseInput,
        steps: [{ title: "S", description: "d" }],
      });
      const paused = await service.pause(wf.id);
      expect(paused!.status).toBe("paused");
    } finally {
      await cleanup();
    }
  });

  it("resume sets status to running", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create({
        ...baseInput,
        steps: [{ title: "S", description: "d" }],
      });
      await service.pause(wf.id);
      const resumed = await service.resume(wf.id);
      expect(resumed!.status).toBe("running");
    } finally {
      await cleanup();
    }
  });

  it("cancel sets status and skips pending steps", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create({
        ...baseInput,
        steps: [
          { title: "S1", description: "d" },
          { title: "S2", description: "d" },
        ],
      });
      const cancelled = await service.cancel(wf.id);
      expect(cancelled!.status).toBe("cancelled");
      expect(cancelled!.steps.every((s) => s.status === "skipped")).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// retryStep
// ---------------------------------------------------------------------------

describe("WorkflowService.retryStep", () => {
  it("resets a failed step to pending", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create({
        ...baseInput,
        steps: [{ title: "S1", description: "d" }],
      });
      const stepId = wf.steps[0]!.id;

      // Mark as failed
      await service.updateStep(wf.id, stepId, {
        status: "failed",
        error: "something broke",
      });

      const retried = await service.retryStep(wf.id, stepId);
      expect(retried!.steps[0]!.status).toBe("pending");
      expect(retried!.steps[0]!.error).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("returns null for non-failed step", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create({
        ...baseInput,
        steps: [{ title: "S1", description: "d" }],
      });
      const result = await service.retryStep(wf.id, wf.steps[0]!.id);
      expect(result).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("WorkflowService.delete", () => {
  it("deletes a workflow", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create(baseInput);
      const deleted = await service.delete(wf.id);
      expect(deleted).toBe(true);
      const found = await service.get(wf.id);
      expect(found).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("returns false for unknown ID", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const deleted = await service.delete("nope");
      expect(deleted).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

describe("WorkflowService events", () => {
  it("addEvent writes and getEvents reads", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const wf = await service.create(baseInput);

      await service.addEvent(wf.id, "info", "test event");
      // +1 from the status_change event during create
      const events = await service.getEvents(wf.id);
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.some((e) => e.message === "test event")).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// policies
// ---------------------------------------------------------------------------

describe("WorkflowService policies", () => {
  it("getPolicies returns defaults initially", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const policies = await service.getPolicies();
      expect(policies.sessions.maxConcurrent).toBe(2);
    } finally {
      await cleanup();
    }
  });

  it("updatePolicies merges and persists", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service, events } = makeService(storePath);
      const updated = await service.updatePolicies({
        sessions: {
          maxConcurrent: 5,
          maxTokensPerStep: 200_000,
          maxTokensPerWorkflow: 1_000_000,
          timeoutMs: 600_000,
          allowedModes: ["Claude"],
        },
      });
      expect(updated.sessions.maxConcurrent).toBe(5);
      // Verify persistence
      const reread = await service.getPolicies();
      expect(reread.sessions.maxConcurrent).toBe(5);
      // Verify broadcast
      expect(events.some((e) => e.event === "workflow.policies.updated")).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrent access (locking)
// ---------------------------------------------------------------------------

describe("WorkflowService locking", () => {
  it("handles concurrent creates without corruption", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const { service } = makeService(storePath);
      const promises = Array.from({ length: 10 }, (_, i) =>
        service.create({ ...baseInput, title: `Workflow ${i}` }),
      );
      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);

      const all = await service.list();
      expect(all).toHaveLength(10);
    } finally {
      await cleanup();
    }
  });
});

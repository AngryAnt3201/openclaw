import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Workflow, WorkflowStoreFile } from "../workflow/types.js";
import {
  resolveWorkflowContextSnapshot,
  resolveWorkflowContextForHeartbeat,
} from "./heartbeat-workflow-context.js";

async function makeTmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-wf-hb-"));
  return {
    dir,
    storePath: path.join(dir, "store.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function makeWorkflow(overrides?: Partial<Workflow>): Workflow {
  return {
    id: "wf-1",
    title: "Test Workflow",
    description: "desc",
    status: "running",
    trigger: "manual",
    repo: { path: "/tmp", remote: "origin", remoteUrl: "", owner: "test", name: "repo" },
    baseBranch: "main",
    workBranch: "feat/test",
    steps: [
      {
        id: "s1",
        index: 0,
        title: "Step 1",
        description: "d",
        status: "complete",
        sessionMode: "Claude",
        dependsOn: [],
        commitsBefore: [],
        commitsAfter: [],
        filesChanged: [],
        tokenUsage: 0,
        toolCalls: 0,
      },
      {
        id: "s2",
        index: 1,
        title: "Step 2",
        description: "d",
        status: "running",
        sessionMode: "Claude",
        dependsOn: ["s1"],
        commitsBefore: [],
        commitsAfter: [],
        filesChanged: [],
        tokenUsage: 0,
        toolCalls: 0,
      },
    ],
    currentStepIndex: 1,
    createdAtMs: 1000,
    updatedAtMs: 2000,
    totalTokens: 5000,
    totalCost: 0.01,
    totalToolCalls: 10,
    ...overrides,
  };
}

async function writeStore(storePath: string, workflows: Workflow[]): Promise<void> {
  const store: WorkflowStoreFile = { version: 1, workflows };
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(store), "utf-8");
}

// ---------------------------------------------------------------------------
// resolveWorkflowContextSnapshot
// ---------------------------------------------------------------------------

describe("resolveWorkflowContextSnapshot", () => {
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

  it("returns null when storePath is undefined", async () => {
    const result = await resolveWorkflowContextSnapshot(undefined);
    expect(result.contextText).toBeNull();
    expect(result.count).toBe(0);
  });

  it("returns null when no active workflows", async () => {
    await writeStore(storePath, []);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.contextText).toBeNull();
    expect(result.count).toBe(0);
  });

  it("excludes merged and cancelled workflows", async () => {
    await writeStore(storePath, [
      makeWorkflow({ id: "wf-merged", status: "merged" }),
      makeWorkflow({ id: "wf-cancelled", status: "cancelled" }),
      makeWorkflow({ id: "wf-failed", status: "failed" }),
    ]);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.contextText).toBeNull();
    expect(result.count).toBe(0);
  });

  it("includes running workflows", async () => {
    await writeStore(storePath, [makeWorkflow()]);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.contextText).toBeTruthy();
    expect(result.count).toBe(1);
    expect(result.contextText).toContain("Test Workflow");
    expect(result.contextText).toContain("running");
  });

  it("includes planning workflows", async () => {
    await writeStore(storePath, [makeWorkflow({ status: "planning" })]);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.count).toBe(1);
  });

  it("includes paused workflows", async () => {
    await writeStore(storePath, [makeWorkflow({ status: "paused" })]);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.count).toBe(1);
  });

  it("includes pr_open workflows", async () => {
    await writeStore(storePath, [makeWorkflow({ status: "pr_open" })]);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.count).toBe(1);
  });

  it("shows step progress in summary", async () => {
    await writeStore(storePath, [makeWorkflow()]);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.contextText).toContain("1/2 done");
    expect(result.contextText).toContain("1 running");
  });

  it("shows PR number when present", async () => {
    await writeStore(storePath, [
      makeWorkflow({
        status: "pr_open",
        pullRequest: {
          number: 42,
          url: "",
          title: "",
          body: "",
          state: "draft",
          headBranch: "",
          baseBranch: "",
          additions: 0,
          deletions: 0,
          filesChanged: 0,
          checks: [],
          createdAtMs: 0,
          updatedAtMs: 0,
        },
      }),
    ]);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.contextText).toContain("PR #42");
  });

  it("shows repo context", async () => {
    await writeStore(storePath, [makeWorkflow()]);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.contextText).toContain("[test/repo]");
  });

  it("limits to MAX_WORKFLOW_SUMMARY_LINES", async () => {
    const workflows = Array.from({ length: 12 }, (_, i) =>
      makeWorkflow({ id: `wf-${i}`, title: `WF ${i}`, createdAtMs: i }),
    );
    await writeStore(storePath, workflows);
    const result = await resolveWorkflowContextSnapshot(storePath);
    expect(result.count).toBe(12);
    expect(result.contextText).toContain("4 more workflows not shown");
  });

  it("returns null context when store read fails", async () => {
    const result = await resolveWorkflowContextSnapshot("/nonexistent/store.json");
    expect(result.contextText).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveWorkflowContextForHeartbeat (deprecated wrapper)
// ---------------------------------------------------------------------------

describe("resolveWorkflowContextForHeartbeat", () => {
  it("returns text for active workflows", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      await writeStore(storePath, [makeWorkflow()]);
      const text = await resolveWorkflowContextForHeartbeat(storePath);
      expect(text).toBeTruthy();
      expect(text).toContain("Test Workflow");
    } finally {
      await cleanup();
    }
  });

  it("returns null for empty store", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      await writeStore(storePath, []);
      const text = await resolveWorkflowContextForHeartbeat(storePath);
      expect(text).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStoreFile, WorkflowEvent, WorkflowPolicies } from "./types.js";
import {
  appendWorkflowEvent,
  readWorkflowEvents,
  readWorkflowPolicies,
  readWorkflowStore,
  resolveWorkflowEventsDir,
  resolveWorkflowEventLogPath,
  resolveWorkflowPoliciesPath,
  resolveWorkflowStorePath,
  writeWorkflowPolicies,
  writeWorkflowStore,
} from "./store.js";
import { defaultPolicies } from "./types.js";

async function makeTmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workflow-store-"));
  return {
    dir,
    storePath: path.join(dir, "store.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolveWorkflowStorePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default path under ~/.openclaw/workflows/ when no custom path given", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolveWorkflowStorePath();
    expect(result).toBe(path.join("/home/testuser", ".openclaw", "workflows", "store.json"));
  });

  it("resolves custom path when provided", () => {
    const result = resolveWorkflowStorePath("/custom/path/workflows.json");
    expect(result).toBe(path.resolve("/custom/path/workflows.json"));
  });
});

describe("resolveWorkflowEventsDir", () => {
  it("returns events dir relative to store parent", () => {
    const result = resolveWorkflowEventsDir("/home/user/.openclaw/workflows/store.json");
    expect(result).toBe(path.join("/home/user/.openclaw/workflows", "events"));
  });
});

describe("resolveWorkflowEventLogPath", () => {
  it("returns JSONL path for workflow ID", () => {
    const result = resolveWorkflowEventLogPath(
      "/home/user/.openclaw/workflows/store.json",
      "wf-abc",
    );
    expect(result).toBe(path.join("/home/user/.openclaw/workflows", "events", "wf-abc.jsonl"));
  });
});

describe("resolveWorkflowPoliciesPath", () => {
  it("returns policies path relative to store parent", () => {
    const result = resolveWorkflowPoliciesPath("/home/user/.openclaw/workflows/store.json");
    expect(result).toBe(path.join("/home/user/.openclaw/workflows", "policies.json"));
  });
});

// ---------------------------------------------------------------------------
// Store read/write
// ---------------------------------------------------------------------------

describe("readWorkflowStore", () => {
  it("returns empty store when file does not exist", async () => {
    const store = await readWorkflowStore("/nonexistent/store.json");
    expect(store).toEqual({ version: 1, workflows: [] });
  });

  it("returns empty store when file has invalid JSON", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      await fs.writeFile(storePath, "not json", "utf-8");
      const store = await readWorkflowStore(storePath);
      expect(store).toEqual({ version: 1, workflows: [] });
    } finally {
      await cleanup();
    }
  });

  it("reads a valid store file", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const data: WorkflowStoreFile = {
        version: 1,
        workflows: [
          {
            id: "wf-1",
            title: "Test",
            description: "desc",
            status: "planning",
            trigger: "manual",
            repo: { path: "/tmp", remote: "origin", remoteUrl: "", owner: "o", name: "r" },
            baseBranch: "main",
            workBranch: "feat/test",
            steps: [],
            currentStepIndex: 0,
            createdAtMs: 1000,
            updatedAtMs: 1000,
            totalTokens: 0,
            totalCost: 0,
            totalToolCalls: 0,
          },
        ],
      };
      await fs.writeFile(storePath, JSON.stringify(data), "utf-8");
      const store = await readWorkflowStore(storePath);
      expect(store.workflows).toHaveLength(1);
      expect(store.workflows[0]!.id).toBe("wf-1");
    } finally {
      await cleanup();
    }
  });
});

describe("writeWorkflowStore", () => {
  it("creates directories and writes atomically", async () => {
    const { dir, storePath, cleanup } = await makeTmpStore();
    try {
      const nested = path.join(dir, "sub", "store.json");
      const data: WorkflowStoreFile = { version: 1, workflows: [] };
      await writeWorkflowStore(nested, data);

      const raw = await fs.readFile(nested, "utf-8");
      expect(JSON.parse(raw)).toEqual(data);
    } finally {
      await cleanup();
    }
  });

  it("does not leave tmp files on success", async () => {
    const { dir, storePath, cleanup } = await makeTmpStore();
    try {
      await writeWorkflowStore(storePath, { version: 1, workflows: [] });
      const files = await fs.readdir(dir);
      expect(files).not.toContain("store.json.tmp");
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Empty store factory isolation
// ---------------------------------------------------------------------------

describe("empty store factory", () => {
  it("returns distinct arrays for each call (no shared ref bug)", async () => {
    const store1 = await readWorkflowStore("/nonexistent/a.json");
    const store2 = await readWorkflowStore("/nonexistent/b.json");
    expect(store1.workflows).not.toBe(store2.workflows);
  });
});

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

describe("appendWorkflowEvent + readWorkflowEvents", () => {
  it("appends and reads events", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const event: WorkflowEvent = {
        id: "evt-1",
        workflowId: "wf-1",
        type: "status_change",
        timestamp: 1000,
        message: "created",
      };
      await appendWorkflowEvent(storePath, event);
      await appendWorkflowEvent(storePath, { ...event, id: "evt-2", message: "running" });

      const events = await readWorkflowEvents(storePath, "wf-1");
      expect(events).toHaveLength(2);
      expect(events[0]!.id).toBe("evt-1");
      expect(events[1]!.id).toBe("evt-2");
    } finally {
      await cleanup();
    }
  });

  it("respects limit option (returns last N)", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      for (let i = 0; i < 5; i++) {
        await appendWorkflowEvent(storePath, {
          id: `evt-${i}`,
          workflowId: "wf-1",
          type: "info",
          timestamp: 1000 + i,
          message: `event ${i}`,
        });
      }
      const events = await readWorkflowEvents(storePath, "wf-1", { limit: 2 });
      expect(events).toHaveLength(2);
      expect(events[0]!.id).toBe("evt-3");
      expect(events[1]!.id).toBe("evt-4");
    } finally {
      await cleanup();
    }
  });

  it("returns empty array for nonexistent workflow", async () => {
    const events = await readWorkflowEvents("/nonexistent/store.json", "wf-nope");
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

describe("readWorkflowPolicies", () => {
  it("returns defaults when no policies file exists", async () => {
    const policies = await readWorkflowPolicies("/nonexistent/store.json");
    expect(policies).toEqual(defaultPolicies());
  });

  it("reads and merges with defaults", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const partial = {
        branchPrefixes: {
          feature: "feature/",
          fix: "fix/",
          chore: "chore/",
          refactor: "refactor/",
        },
        pr: {
          requireReview: false,
          minReviewScore: 50,
          requireTests: false,
          maxFilesChanged: 50,
          labels: [],
          assignees: [],
        },
        sessions: {
          maxConcurrent: 4,
          maxTokensPerStep: 200_000,
          maxTokensPerWorkflow: 1_000_000,
          timeoutMs: 600_000,
          allowedModes: ["Claude"],
        },
        commits: { conventionalCommits: true, signOff: false, maxMessageLength: 72 },
        safety: {
          protectedBranches: ["main"],
          requireApprovalForForceOps: true,
          maxDeletionsPerPR: 500,
        },
      };
      const policiesPath = resolveWorkflowPoliciesPath(storePath);
      await fs.mkdir(path.dirname(policiesPath), { recursive: true });
      await fs.writeFile(policiesPath, JSON.stringify(partial), "utf-8");

      const result = await readWorkflowPolicies(storePath);
      expect(result.sessions.maxConcurrent).toBe(4);
      expect(result.pr.requireReview).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

describe("writeWorkflowPolicies", () => {
  it("writes policies atomically", async () => {
    const { storePath, cleanup } = await makeTmpStore();
    try {
      const policies = defaultPolicies();
      policies.sessions.maxConcurrent = 8;
      await writeWorkflowPolicies(storePath, policies);

      const result = await readWorkflowPolicies(storePath);
      expect(result.sessions.maxConcurrent).toBe(8);
    } finally {
      await cleanup();
    }
  });
});

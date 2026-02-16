import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task, TaskStoreFile } from "../tasks/types.js";
import { writeTaskStore } from "../tasks/store.js";
import { resolveTaskContextForHeartbeat } from "./heartbeat-task-context.js";

let tmpDir: string;
let storePath: string;

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    description: "",
    status: "pending",
    priority: "medium",
    type: "instruction",
    source: "user",
    agentId: "default",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "heartbeat-task-ctx-"));
  storePath = path.join(tmpDir, "store.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveTaskContextForHeartbeat", () => {
  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("returns null when taskStorePath is undefined", async () => {
    expect(await resolveTaskContextForHeartbeat(undefined)).toBeNull();
  });

  it("returns null when task store does not exist", async () => {
    const result = await resolveTaskContextForHeartbeat(path.join(tmpDir, "nonexistent-dir"));
    expect(result).toBeNull();
  });

  it("returns null when task store is empty", async () => {
    const store: TaskStoreFile = { version: 1, tasks: [] };
    await writeTaskStore(storePath, store);
    expect(await resolveTaskContextForHeartbeat(storePath)).toBeNull();
  });

  it("returns null when all tasks are in terminal states", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [
        makeTask({ id: "t1", title: "Done task", status: "complete" }),
        makeTask({ id: "t2", title: "Failed task", status: "failed" }),
        makeTask({ id: "t3", title: "Cancelled task", status: "cancelled" }),
      ],
    };
    await writeTaskStore(storePath, store);
    expect(await resolveTaskContextForHeartbeat(storePath)).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Active task detection
  // -----------------------------------------------------------------------

  it("includes pending tasks", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [makeTask({ id: "abc12345-0000", title: "Pending work", status: "pending" })],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).not.toBeNull();
    expect(result).toContain("Pending work");
    expect(result).toContain("pending");
    expect(result).toContain("Active tasks (1)");
  });

  it("includes in_progress tasks", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [makeTask({ id: "abc12345-1111", title: "Running task", status: "in_progress" })],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Running task");
    expect(result).toContain("in progress");
  });

  it("includes queued tasks", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [makeTask({ id: "abc12345-2222", title: "Queued task", status: "queued" })],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Queued task");
  });

  it("includes input_required tasks", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [makeTask({ id: "abc12345-3333", title: "Needs input", status: "input_required" })],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Needs input");
    expect(result).toContain("input required");
  });

  it("includes approval_required tasks", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [
        makeTask({ id: "abc12345-4444", title: "Needs approval", status: "approval_required" }),
      ],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Needs approval");
    expect(result).toContain("approval required");
  });

  it("includes review tasks", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [makeTask({ id: "abc12345-5555", title: "Under review", status: "review" })],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Under review");
  });

  it("includes paused tasks", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [makeTask({ id: "abc12345-6666", title: "Paused work", status: "paused" })],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Paused work");
  });

  // -----------------------------------------------------------------------
  // Filtering
  // -----------------------------------------------------------------------

  it("excludes complete, failed, and cancelled tasks", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [
        makeTask({ id: "t1", title: "Active", status: "in_progress" }),
        makeTask({ id: "t2", title: "Done", status: "complete" }),
        makeTask({ id: "t3", title: "Broken", status: "failed" }),
        makeTask({ id: "t4", title: "Stopped", status: "cancelled" }),
      ],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Active");
    expect(result).not.toContain("Done");
    expect(result).not.toContain("Broken");
    expect(result).not.toContain("Stopped");
    expect(result).toContain("Active tasks (1)");
  });

  // -----------------------------------------------------------------------
  // Formatting
  // -----------------------------------------------------------------------

  it("includes task-level ref index for the task", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [
        makeTask({
          id: "abcdefgh-1234-5678-9012-345678901234",
          title: "Test task",
          status: "pending",
        }),
      ],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    // First task gets {ref:0}
    expect(result).toContain("{ref:0}");
    expect(result).toContain("Test task");
  });

  it("includes priority", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [makeTask({ id: "t1", title: "Urgent task", status: "pending", priority: "high" })],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("high");
  });

  it("includes task_create and task_update instructions", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [makeTask({ id: "t1", title: "Task", status: "pending" })],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("task_create");
    expect(result).toContain("task_update");
  });

  // -----------------------------------------------------------------------
  // Multiple tasks
  // -----------------------------------------------------------------------

  it("lists multiple active tasks", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [
        makeTask({ id: "t1", title: "Task A", status: "pending" }),
        makeTask({ id: "t2", title: "Task B", status: "in_progress" }),
        makeTask({ id: "t3", title: "Task C", status: "review" }),
      ],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Active tasks (3)");
    expect(result).toContain("Task A");
    expect(result).toContain("Task B");
    expect(result).toContain("Task C");
  });

  // -----------------------------------------------------------------------
  // Overflow truncation (max 10 lines)
  // -----------------------------------------------------------------------

  it("truncates to 10 tasks and shows overflow count", async () => {
    const tasks: Task[] = [];
    for (let i = 0; i < 15; i++) {
      tasks.push(makeTask({ id: `t${i}`, title: `Task ${i}`, status: "pending" }));
    }
    const store: TaskStoreFile = { version: 1, tasks };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Active tasks (15)");
    expect(result).toContain("Task 0");
    expect(result).toContain("Task 9");
    expect(result).not.toContain("Task 10");
    expect(result).toContain("5 more tasks not shown");
  });

  it("does not show overflow message for exactly 10 tasks", async () => {
    const tasks: Task[] = [];
    for (let i = 0; i < 10; i++) {
      tasks.push(makeTask({ id: `t${i}`, title: `Task ${i}`, status: "pending" }));
    }
    const store: TaskStoreFile = { version: 1, tasks };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Active tasks (10)");
    expect(result).not.toContain("more tasks not shown");
  });

  // -----------------------------------------------------------------------
  // Mixed active and terminal tasks
  // -----------------------------------------------------------------------

  it("correctly counts only active tasks in header", async () => {
    const store: TaskStoreFile = {
      version: 1,
      tasks: [
        makeTask({ id: "t1", title: "Active 1", status: "pending" }),
        makeTask({ id: "t2", title: "Done 1", status: "complete" }),
        makeTask({ id: "t3", title: "Active 2", status: "in_progress" }),
        makeTask({ id: "t4", title: "Failed 1", status: "failed" }),
        makeTask({ id: "t5", title: "Active 3", status: "approval_required" }),
      ],
    };
    await writeTaskStore(storePath, store);
    const result = await resolveTaskContextForHeartbeat(storePath);
    expect(result).toContain("Active tasks (3)");
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("returns null for corrupt store file", async () => {
    await fs.writeFile(storePath, "not json at all");
    expect(await resolveTaskContextForHeartbeat(storePath)).toBeNull();
  });

  it("returns null for store with wrong version", async () => {
    await fs.writeFile(storePath, JSON.stringify({ version: 99, tasks: [] }));
    expect(await resolveTaskContextForHeartbeat(storePath)).toBeNull();
  });
});

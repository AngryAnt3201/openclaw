import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskCreateInput } from "./types.js";
import { TaskService } from "./service.js";
import { readTaskEvents, readTaskStore } from "./store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-svc-"));
  return {
    dir,
    storePath: path.join(dir, "store.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function makeService(storePath: string) {
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  const logs: string[] = [];
  const service = new TaskService({
    storePath,
    log: {
      info: (msg) => logs.push(`INFO: ${msg}`),
      warn: (msg) => logs.push(`WARN: ${msg}`),
      error: (msg) => logs.push(`ERROR: ${msg}`),
    },
    broadcast: (event, payload) => {
      broadcasts.push({ event, payload });
    },
    nowMs: () => 1000000,
  });
  return { service, broadcasts, logs };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe("TaskService.create", () => {
  it("creates a task with default values", async () => {
    const tmp = await makeTmpStore();
    const { service, broadcasts } = makeService(tmp.storePath);

    const task = await service.create({ title: "Test Task" });

    expect(task.id).toBeTruthy();
    expect(task.title).toBe("Test Task");
    expect(task.description).toBe("");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe("medium");
    expect(task.type).toBe("instruction");
    expect(task.source).toBe("user");
    expect(task.agentId).toBe("default");
    expect(task.createdAtMs).toBe(1000000);
    expect(task.updatedAtMs).toBe(1000000);

    // Verify persisted
    const store = await readTaskStore(tmp.storePath);
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0]!.id).toBe(task.id);

    // Verify broadcast
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.event).toBe("task.created");

    // Verify event log
    const events = await readTaskEvents(tmp.storePath, task.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("status_change");
    expect(events[0]!.message).toBe("Task created");

    await tmp.cleanup();
  });

  it("creates a task with all custom values", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({
      title: "Custom Task",
      description: "A detailed description",
      type: "workflow",
      source: "cron",
      priority: "high",
      agentId: "agent-42",
      parentTaskId: "parent-1",
      permissions: { preset: "research" },
      app: { name: "TestApp", icon: "star" },
    });

    expect(task.title).toBe("Custom Task");
    expect(task.description).toBe("A detailed description");
    expect(task.type).toBe("workflow");
    expect(task.source).toBe("cron");
    expect(task.priority).toBe("high");
    expect(task.agentId).toBe("agent-42");
    expect(task.parentTaskId).toBe("parent-1");
    expect(task.permissions).toEqual({ preset: "research" });
    expect(task.app).toEqual({ name: "TestApp", icon: "star" });

    await tmp.cleanup();
  });

  it("preserves metadata on create", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const meta = { credentialId: "cred-1", agentId: "agent-1", reason: "need API key" };
    const task = await service.create({
      title: "Credential access",
      type: "approval_gate",
      metadata: meta,
    });

    expect(task.metadata).toEqual(meta);

    // Verify persisted
    const store = await readTaskStore(tmp.storePath);
    expect(store.tasks[0]!.metadata).toEqual(meta);

    await tmp.cleanup();
  });

  it("creates a task without metadata (undefined)", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "No metadata" });
    expect(task.metadata).toBeUndefined();

    await tmp.cleanup();
  });

  it("creates multiple tasks with unique IDs", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task1 = await service.create({ title: "Task 1" });
    const task2 = await service.create({ title: "Task 2" });
    const task3 = await service.create({ title: "Task 3" });

    expect(task1.id).not.toBe(task2.id);
    expect(task2.id).not.toBe(task3.id);

    const store = await readTaskStore(tmp.storePath);
    expect(store.tasks).toHaveLength(3);

    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe("TaskService.update", () => {
  it("updates task fields", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Original" });
    const updated = await service.update(task.id, {
      title: "Updated",
      description: "New description",
      priority: "high",
      progress: 50,
      progressMessage: "Halfway there",
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("Updated");
    expect(updated!.description).toBe("New description");
    expect(updated!.priority).toBe("high");
    expect(updated!.progress).toBe(50);
    expect(updated!.progressMessage).toBe("Halfway there");
    expect(updated!.updatedAtMs).toBe(1000000);

    await tmp.cleanup();
  });

  it("updates metadata field", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({
      title: "Gate",
      type: "approval_gate",
      metadata: { credentialId: "cred-1" },
    });

    const updated = await service.update(task.id, {
      metadata: { credentialId: "cred-1", agentId: "agent-1", extra: true },
    });

    expect(updated!.metadata).toEqual({
      credentialId: "cred-1",
      agentId: "agent-1",
      extra: true,
    });

    // Verify persisted
    const store = await readTaskStore(tmp.storePath);
    expect(store.tasks[0]!.metadata).toEqual(updated!.metadata);

    await tmp.cleanup();
  });

  it("emits status_change event on status transition", async () => {
    const tmp = await makeTmpStore();
    const { service, broadcasts } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    broadcasts.length = 0; // Clear create broadcast

    await service.update(task.id, { status: "in_progress" });

    // Should have: task.updated
    const statusBroadcasts = broadcasts.filter((b) => b.event === "task.updated");
    expect(statusBroadcasts).toHaveLength(1);

    // Check event log has status_change
    const events = await readTaskEvents(tmp.storePath, task.id);
    const statusEvents = events.filter((e) => e.type === "status_change");
    expect(statusEvents.length).toBeGreaterThanOrEqual(2); // created + updated
    const last = statusEvents[statusEvents.length - 1]!;
    expect(last.data).toEqual({ from: "pending", to: "in_progress" });

    await tmp.cleanup();
  });

  it("emits task.completed on completion", async () => {
    const tmp = await makeTmpStore();
    const { service, broadcasts } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    broadcasts.length = 0;

    await service.update(task.id, { status: "complete" });

    const completedEvents = broadcasts.filter((b) => b.event === "task.completed");
    expect(completedEvents).toHaveLength(1);

    await tmp.cleanup();
  });

  it("emits task.input_required on input needed", async () => {
    const tmp = await makeTmpStore();
    const { service, broadcasts } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    broadcasts.length = 0;

    await service.update(task.id, {
      status: "input_required",
      inputPrompt: "What color?",
    });

    const inputEvents = broadcasts.filter((b) => b.event === "task.input_required");
    expect(inputEvents).toHaveLength(1);

    await tmp.cleanup();
  });

  it("emits task.approval_required on approval needed", async () => {
    const tmp = await makeTmpStore();
    const { service, broadcasts } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    broadcasts.length = 0;

    await service.update(task.id, { status: "approval_required" });

    const approvalEvents = broadcasts.filter((b) => b.event === "task.approval_required");
    expect(approvalEvents).toHaveLength(1);

    await tmp.cleanup();
  });

  it("returns null for non-existent task", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const result = await service.update("nonexistent", { title: "x" });
    expect(result).toBeNull();

    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("TaskService.cancel", () => {
  it("sets status to cancelled", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "To Cancel" });
    const cancelled = await service.cancel(task.id);

    expect(cancelled).not.toBeNull();
    expect(cancelled!.status).toBe("cancelled");

    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Respond
// ---------------------------------------------------------------------------

describe("TaskService.respond", () => {
  it("transitions from input_required to in_progress", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    await service.update(task.id, {
      status: "input_required",
      inputPrompt: "Choose a color",
    });

    const responded = await service.respond(task.id, "Blue");

    expect(responded).not.toBeNull();
    expect(responded!.status).toBe("in_progress");
    expect(responded!.inputPrompt).toBeUndefined();

    // Check event log
    const events = await readTaskEvents(tmp.storePath, task.id);
    const inputEvents = events.filter((e) => e.type === "input_provided");
    expect(inputEvents).toHaveLength(1);
    expect(inputEvents[0]!.data?.response).toBe("Blue");

    await tmp.cleanup();
  });

  it("returns null for non-existent task", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);
    const result = await service.respond("missing", "answer");
    expect(result).toBeNull();
    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Approve / Reject
// ---------------------------------------------------------------------------

describe("TaskService.approve", () => {
  it("clears approval request and resumes task", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    await service.update(task.id, {
      status: "approval_required",
      approvalRequest: {
        id: "ar-1",
        toolName: "browser",
        action: "navigate",
        severity: "high",
        reason: "Financial site",
        createdAtMs: 1000000,
      },
    });

    const approved = await service.approve(task.id);

    expect(approved).not.toBeNull();
    expect(approved!.status).toBe("in_progress");
    expect(approved!.approvalRequest).toBeUndefined();

    // Check event log
    const events = await readTaskEvents(tmp.storePath, task.id);
    const approvalEvents = events.filter((e) => e.type === "approval_resolved");
    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0]!.data?.action).toBe("approved");

    await tmp.cleanup();
  });
});

describe("TaskService.reject", () => {
  it("rejects and logs reason", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    await service.update(task.id, {
      status: "approval_required",
      approvalRequest: {
        id: "ar-1",
        toolName: "exec",
        action: "rm -rf",
        severity: "critical",
        reason: "Destructive command",
        createdAtMs: 1000000,
      },
    });

    const rejected = await service.reject(task.id, "Too dangerous");

    expect(rejected).not.toBeNull();
    expect(rejected!.status).toBe("in_progress");
    expect(rejected!.approvalRequest).toBeUndefined();

    const events = await readTaskEvents(tmp.storePath, task.id);
    const rejEvents = events.filter((e) => e.type === "approval_resolved");
    expect(rejEvents).toHaveLength(1);
    expect(rejEvents[0]!.data?.action).toBe("rejected");
    expect(rejEvents[0]!.data?.reason).toBe("Too dangerous");

    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// addEvent
// ---------------------------------------------------------------------------

describe("TaskService.addEvent", () => {
  it("appends an event and broadcasts", async () => {
    const tmp = await makeTmpStore();
    const { service, broadcasts } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    broadcasts.length = 0;

    const event = await service.addEvent(task.id, "tool_use", "Called browser.navigate", {
      url: "https://example.com",
    });

    expect(event.id).toBeTruthy();
    expect(event.taskId).toBe(task.id);
    expect(event.type).toBe("tool_use");
    expect(event.message).toBe("Called browser.navigate");
    expect(event.data).toEqual({ url: "https://example.com" });

    const eventBroadcasts = broadcasts.filter((b) => b.event === "task.event");
    expect(eventBroadcasts).toHaveLength(1);

    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// updateProgress
// ---------------------------------------------------------------------------

describe("TaskService.updateProgress", () => {
  it("updates progress and broadcasts", async () => {
    const tmp = await makeTmpStore();
    const { service, broadcasts } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    broadcasts.length = 0;

    const updated = await service.updateProgress(task.id, 75, "Almost done");

    expect(updated).not.toBeNull();
    expect(updated!.progress).toBe(75);
    expect(updated!.progressMessage).toBe("Almost done");

    const progressBroadcasts = broadcasts.filter((b) => b.event === "task.progress");
    expect(progressBroadcasts).toHaveLength(1);

    await tmp.cleanup();
  });

  it("clamps progress to 0-100", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });

    const updated1 = await service.updateProgress(task.id, 150);
    expect(updated1!.progress).toBe(100);

    const updated2 = await service.updateProgress(task.id, -10);
    expect(updated2!.progress).toBe(0);

    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// List / Get / GetEvents
// ---------------------------------------------------------------------------

describe("TaskService.list", () => {
  it("returns all tasks without filter", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    await service.create({ title: "Task 1" });
    await service.create({ title: "Task 2" });
    await service.create({ title: "Task 3" });

    const tasks = await service.list();
    expect(tasks).toHaveLength(3);

    await tmp.cleanup();
  });

  it("filters by status", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const t1 = await service.create({ title: "Task 1" });
    await service.create({ title: "Task 2" });
    await service.update(t1.id, { status: "in_progress" });

    const active = await service.list({ status: "in_progress" });
    expect(active).toHaveLength(1);
    expect(active[0]!.title).toBe("Task 1");

    const pending = await service.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.title).toBe("Task 2");

    await tmp.cleanup();
  });

  it("filters by multiple statuses (array)", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const t1 = await service.create({ title: "Task 1" });
    const t2 = await service.create({ title: "Task 2" });
    await service.update(t1.id, { status: "in_progress" });
    await service.update(t2.id, { status: "complete" });
    await service.create({ title: "Task 3" }); // pending

    const filtered = await service.list({ status: ["in_progress", "complete"] });
    expect(filtered).toHaveLength(2);

    await tmp.cleanup();
  });

  it("filters by source", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    await service.create({ title: "User Task", source: "user" });
    await service.create({ title: "Cron Task", source: "cron" });

    const cronTasks = await service.list({ source: "cron" });
    expect(cronTasks).toHaveLength(1);
    expect(cronTasks[0]!.title).toBe("Cron Task");

    await tmp.cleanup();
  });

  it("filters by type", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    await service.create({ title: "Instruction", type: "instruction" });
    await service.create({ title: "Workflow", type: "workflow" });

    const workflows = await service.list({ type: "workflow" });
    expect(workflows).toHaveLength(1);

    await tmp.cleanup();
  });

  it("respects limit", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    for (let i = 0; i < 10; i++) {
      await service.create({ title: `Task ${i}` });
    }

    const limited = await service.list({ limit: 3 });
    expect(limited).toHaveLength(3);

    await tmp.cleanup();
  });
});

describe("TaskService.get", () => {
  it("returns task by ID", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const created = await service.create({ title: "Find Me" });
    const found = await service.get(created.id);

    expect(found).not.toBeNull();
    expect(found!.title).toBe("Find Me");

    await tmp.cleanup();
  });

  it("returns null for non-existent task", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const found = await service.get("nonexistent");
    expect(found).toBeNull();

    await tmp.cleanup();
  });
});

describe("TaskService.getEvents", () => {
  it("returns events for a task", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    await service.addEvent(task.id, "tool_use", "Called something");
    await service.addEvent(task.id, "progress", "30%");

    const events = await service.getEvents(task.id);
    // 1 from create (status_change) + 2 added = 3
    expect(events).toHaveLength(3);

    await tmp.cleanup();
  });

  it("respects limit parameter", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    for (let i = 0; i < 10; i++) {
      await service.addEvent(task.id, "progress", `Event ${i}`);
    }

    const events = await service.getEvents(task.id, 3);
    expect(events).toHaveLength(3);

    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// addStatusUpdate / getStatusUpdates
// ---------------------------------------------------------------------------

describe("TaskService.addStatusUpdate", () => {
  it("creates a status update and emits event", async () => {
    const tmp = await makeTmpStore();
    const { service, broadcasts } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    broadcasts.length = 0;

    const update = await service.addStatusUpdate({
      taskId: task.id,
      type: "milestone",
      title: "Step 1 complete",
      body: "Finished the first step",
    });

    expect(update.id).toBeTruthy();
    expect(update.taskId).toBe(task.id);
    expect(update.type).toBe("milestone");
    expect(update.title).toBe("Step 1 complete");
    expect(update.body).toBe("Finished the first step");
    expect(update.source).toBe("agent");
    expect(update.timestamp).toBe(1000000);

    const statusBroadcasts = broadcasts.filter((b) => b.event === "task.statusUpdate");
    expect(statusBroadcasts).toHaveLength(1);

    await tmp.cleanup();
  });

  it("syncs progress to task when provided", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    await service.addStatusUpdate({
      taskId: task.id,
      title: "Halfway",
      progress: 50,
    });

    const updated = await service.get(task.id);
    expect(updated!.progress).toBe(50);

    await tmp.cleanup();
  });

  it("throws for non-existent task", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    await expect(service.addStatusUpdate({ taskId: "missing", title: "Oops" })).rejects.toThrow(
      "task not found: missing",
    );

    await tmp.cleanup();
  });

  it("defaults to progress type and agent source", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    const update = await service.addStatusUpdate({
      taskId: task.id,
      title: "Some update",
    });

    expect(update.type).toBe("progress");
    expect(update.source).toBe("agent");

    await tmp.cleanup();
  });
});

describe("TaskService.getStatusUpdates", () => {
  it("returns updates for a task", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });
    await service.addStatusUpdate({ taskId: task.id, title: "Update 1" });
    await service.addStatusUpdate({ taskId: task.id, title: "Update 2" });

    const updates = await service.getStatusUpdates(task.id);
    expect(updates).toHaveLength(2);

    await tmp.cleanup();
  });

  it("returns empty array for task with no updates", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const updates = await service.getStatusUpdates("nonexistent");
    expect(updates).toEqual([]);

    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Concurrent access safety
// ---------------------------------------------------------------------------

describe("TaskService concurrent operations", () => {
  it("handles concurrent creates safely", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    // Launch 10 concurrent creates
    const promises = Array.from({ length: 10 }, (_, i) => service.create({ title: `Task ${i}` }));
    const tasks = await Promise.all(promises);

    // All 10 should succeed with unique IDs
    const ids = new Set(tasks.map((t) => t.id));
    expect(ids.size).toBe(10);

    const store = await readTaskStore(tmp.storePath);
    expect(store.tasks).toHaveLength(10);

    await tmp.cleanup();
  });

  it("handles concurrent updates safely", async () => {
    const tmp = await makeTmpStore();
    const { service } = makeService(tmp.storePath);

    const task = await service.create({ title: "Task" });

    // Launch 5 concurrent progress updates
    const promises = Array.from({ length: 5 }, (_, i) =>
      service.updateProgress(task.id, (i + 1) * 20),
    );
    await Promise.all(promises);

    // Task should exist and have some progress value (last write wins in serial lock)
    const final = await service.get(task.id);
    expect(final).not.toBeNull();
    expect(final!.progress).toBeGreaterThanOrEqual(0);
    expect(final!.progress).toBeLessThanOrEqual(100);

    await tmp.cleanup();
  });
});

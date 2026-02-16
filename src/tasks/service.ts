// ---------------------------------------------------------------------------
// TaskService – Core task management service
// ---------------------------------------------------------------------------
// Follows the CronService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  Task,
  TaskCreateInput,
  TaskEvent,
  TaskEventType,
  TaskFilter,
  TaskPatch,
  TaskStatus,
  StatusUpdate,
  StatusUpdateCreateInput,
} from "./types.js";
import {
  appendTaskEvent,
  readTaskEvents,
  readTaskStore,
  writeTaskStore,
  appendStatusUpdate,
  readStatusUpdates,
} from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type TaskServiceDeps = {
  storePath: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
  nowMs?: () => number;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type TaskServiceState = {
  deps: TaskServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: TaskServiceDeps): TaskServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as cron/service/locked.ts)
// ---------------------------------------------------------------------------

const storeLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: TaskServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// TaskService
// ---------------------------------------------------------------------------

export class TaskService {
  private readonly state: TaskServiceState;

  constructor(deps: TaskServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  private makeEvent(
    taskId: string,
    type: TaskEventType,
    message: string,
    data?: Record<string, unknown>,
  ): TaskEvent {
    return {
      id: randomUUID(),
      taskId,
      type,
      timestamp: this.now(),
      message,
      data,
    };
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(input: TaskCreateInput): Promise<Task> {
    return locked(this.state, async () => {
      const store = await readTaskStore(this.state.deps.storePath);
      const now = this.now();

      const task: Task = {
        id: randomUUID(),
        title: input.title,
        description: input.description ?? "",
        status: "pending",
        priority: input.priority ?? "medium",
        type: input.type ?? "instruction",
        source: input.source ?? "user",
        agentId: input.agentId ?? "default",
        app: input.app,
        parentTaskId: input.parentTaskId,
        permissions: input.permissions,
        cronBinding: input.cronBinding,
        refs: input.refs,
        createdAtMs: now,
        updatedAtMs: now,
      };

      store.tasks.push(task);
      await writeTaskStore(this.state.deps.storePath, store);

      const event = this.makeEvent(task.id, "status_change", "Task created", {
        status: "pending",
      });
      await appendTaskEvent(this.state.deps.storePath, event);

      this.emit("task.created", task);
      this.state.deps.log.info(`task created: ${task.id} — ${task.title}`);

      return task;
    });
  }

  // -------------------------------------------------------------------------
  // update (partial patch)
  // -------------------------------------------------------------------------

  async update(taskId: string, patch: TaskPatch): Promise<Task | null> {
    return locked(this.state, async () => {
      const store = await readTaskStore(this.state.deps.storePath);
      const idx = store.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        return null;
      }

      const task = store.tasks[idx]!;
      const prevStatus = task.status;

      // Apply patch
      if (patch.title !== undefined) {
        task.title = patch.title;
      }
      if (patch.description !== undefined) {
        task.description = patch.description;
      }
      if (patch.status !== undefined) {
        task.status = patch.status;
      }
      if (patch.priority !== undefined) {
        task.priority = patch.priority;
      }
      if (patch.progress !== undefined) {
        task.progress = patch.progress;
      }
      if (patch.progressMessage !== undefined) {
        task.progressMessage = patch.progressMessage;
      }
      if (patch.inputPrompt !== undefined) {
        task.inputPrompt = patch.inputPrompt;
      }
      if (patch.reviewSummary !== undefined) {
        task.reviewSummary = patch.reviewSummary;
      }
      if (patch.sessionKey !== undefined) {
        task.sessionKey = patch.sessionKey;
      }
      if (patch.approvalRequest !== undefined) {
        task.approvalRequest = patch.approvalRequest;
      }
      if (patch.result !== undefined) {
        task.result = patch.result;
      }
      if (patch.liveStream !== undefined) {
        task.liveStream = patch.liveStream;
      }
      if (patch.budgetUsage !== undefined) {
        task.budgetUsage = patch.budgetUsage;
      }
      if (patch.permissions !== undefined) {
        task.permissions = patch.permissions;
      }
      if (patch.subTasks !== undefined) {
        task.subTasks = patch.subTasks;
      }
      if (patch.refs !== undefined) {
        task.refs = patch.refs;
      }
      task.updatedAtMs = this.now();

      store.tasks[idx] = task;
      await writeTaskStore(this.state.deps.storePath, store);

      // Emit status_change event if status changed
      if (patch.status && patch.status !== prevStatus) {
        const event = this.makeEvent(
          task.id,
          "status_change",
          `Status: ${prevStatus} → ${patch.status}`,
          {
            from: prevStatus,
            to: patch.status,
          },
        );
        await appendTaskEvent(this.state.deps.storePath, event);
      }

      this.emit("task.updated", task);

      // Emit specific events for notable status transitions
      if (patch.status === "complete") {
        this.emit("task.completed", task);
      } else if (patch.status === "input_required") {
        this.emit("task.input_required", task);
      } else if (patch.status === "approval_required") {
        this.emit("task.approval_required", task);
      }

      return task;
    });
  }

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------

  async cancel(taskId: string): Promise<Task | null> {
    return this.update(taskId, { status: "cancelled" });
  }

  // -------------------------------------------------------------------------
  // respond (provide human input, resume task)
  // -------------------------------------------------------------------------

  async respond(taskId: string, response: string): Promise<Task | null> {
    return locked(this.state, async () => {
      const store = await readTaskStore(this.state.deps.storePath);
      const idx = store.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        return null;
      }

      const task = store.tasks[idx]!;
      task.status = "in_progress";
      task.inputPrompt = undefined;
      task.updatedAtMs = this.now();
      store.tasks[idx] = task;
      await writeTaskStore(this.state.deps.storePath, store);

      const event = this.makeEvent(task.id, "input_provided", `User responded: ${response}`, {
        response,
      });
      await appendTaskEvent(this.state.deps.storePath, event);

      this.emit("task.updated", task);
      return task;
    });
  }

  // -------------------------------------------------------------------------
  // approve / reject (for approval_required tasks)
  // -------------------------------------------------------------------------

  async approve(taskId: string): Promise<Task | null> {
    return locked(this.state, async () => {
      const store = await readTaskStore(this.state.deps.storePath);
      const idx = store.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        return null;
      }

      const task = store.tasks[idx]!;
      task.status = "in_progress";
      const approval = task.approvalRequest;
      task.approvalRequest = undefined;
      task.updatedAtMs = this.now();
      store.tasks[idx] = task;
      await writeTaskStore(this.state.deps.storePath, store);

      const event = this.makeEvent(task.id, "approval_resolved", "Approved by user", {
        action: "approved",
        toolName: approval?.toolName,
      });
      await appendTaskEvent(this.state.deps.storePath, event);

      this.emit("task.updated", task);
      return task;
    });
  }

  async reject(taskId: string, reason?: string): Promise<Task | null> {
    return locked(this.state, async () => {
      const store = await readTaskStore(this.state.deps.storePath);
      const idx = store.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        return null;
      }

      const task = store.tasks[idx]!;
      task.status = "in_progress";
      const approval = task.approvalRequest;
      task.approvalRequest = undefined;
      task.updatedAtMs = this.now();
      store.tasks[idx] = task;
      await writeTaskStore(this.state.deps.storePath, store);

      const event = this.makeEvent(task.id, "approval_resolved", reason ?? "Rejected by user", {
        action: "rejected",
        reason,
        toolName: approval?.toolName,
      });
      await appendTaskEvent(this.state.deps.storePath, event);

      this.emit("task.updated", task);
      return task;
    });
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(taskId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readTaskStore(this.state.deps.storePath);
      const idx = store.tasks.findIndex((t) => t.id === taskId);
      if (idx === -1) {
        return false;
      }

      store.tasks.splice(idx, 1);
      await writeTaskStore(this.state.deps.storePath, store);

      this.emit("task.deleted", { taskId });
      this.state.deps.log.info(`task deleted: ${taskId}`);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // clearFinished (remove all complete / cancelled / failed)
  // -------------------------------------------------------------------------

  async clearFinished(): Promise<string[]> {
    return locked(this.state, async () => {
      const store = await readTaskStore(this.state.deps.storePath);
      const finished = new Set<TaskStatus>(["complete", "cancelled", "failed"]);
      const removed = store.tasks.filter((t) => finished.has(t.status)).map((t) => t.id);

      if (removed.length === 0) {
        return [];
      }

      store.tasks = store.tasks.filter((t) => !finished.has(t.status));
      await writeTaskStore(this.state.deps.storePath, store);

      for (const id of removed) {
        this.emit("task.deleted", { taskId: id });
      }
      this.state.deps.log.info(`cleared ${removed.length} finished task(s)`);
      return removed;
    });
  }

  // -------------------------------------------------------------------------
  // addEvent
  // -------------------------------------------------------------------------

  async addEvent(
    taskId: string,
    type: TaskEventType,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<TaskEvent> {
    const event = this.makeEvent(taskId, type, message, data);
    await appendTaskEvent(this.state.deps.storePath, event);
    this.emit("task.event", event);
    return event;
  }

  // -------------------------------------------------------------------------
  // updateProgress
  // -------------------------------------------------------------------------

  async updateProgress(taskId: string, progress: number, message?: string): Promise<Task | null> {
    const task = await this.update(taskId, {
      progress: Math.min(100, Math.max(0, progress)),
      progressMessage: message,
    });
    if (task) {
      this.emit("task.progress", { taskId, progress: task.progress, message });
    }
    return task;
  }

  // -------------------------------------------------------------------------
  // addStatusUpdate
  // -------------------------------------------------------------------------

  async addStatusUpdate(input: StatusUpdateCreateInput): Promise<StatusUpdate> {
    return locked(this.state, async () => {
      const store = await readTaskStore(this.state.deps.storePath);
      const task = store.tasks.find((t) => t.id === input.taskId);
      if (!task) {
        throw new Error(`task not found: ${input.taskId}`);
      }

      const update: StatusUpdate = {
        id: randomUUID(),
        taskId: input.taskId,
        type: input.type ?? "progress",
        title: input.title,
        body: input.body ?? "",
        attachments: input.attachments ?? [],
        progress: input.progress,
        timestamp: this.now(),
        source: input.source ?? "agent",
      };

      await appendStatusUpdate(this.state.deps.storePath, update);

      // Optionally sync progress to the task
      if (input.progress !== undefined) {
        task.progress = Math.min(100, Math.max(0, input.progress));
        task.updatedAtMs = this.now();
        await writeTaskStore(this.state.deps.storePath, store);
      }

      this.emit("task.statusUpdate", update);
      return update;
    });
  }

  // -------------------------------------------------------------------------
  // getStatusUpdates
  // -------------------------------------------------------------------------

  async getStatusUpdates(
    taskId: string,
    opts?: { limit?: number; since?: number },
  ): Promise<StatusUpdate[]> {
    return readStatusUpdates(this.state.deps.storePath, taskId, opts);
  }

  // -------------------------------------------------------------------------
  // list / get / getEvents
  // -------------------------------------------------------------------------

  async list(filter?: TaskFilter): Promise<Task[]> {
    const store = await readTaskStore(this.state.deps.storePath);
    let tasks = store.tasks;

    if (filter) {
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        const statusSet = new Set<TaskStatus>(statuses);
        tasks = tasks.filter((t) => statusSet.has(t.status));
      }
      if (filter.source) {
        tasks = tasks.filter((t) => t.source === filter.source);
      }
      if (filter.type) {
        tasks = tasks.filter((t) => t.type === filter.type);
      }
      if (filter.agentId) {
        tasks = tasks.filter((t) => t.agentId === filter.agentId);
      }
      if (filter.parentTaskId) {
        tasks = tasks.filter((t) => t.parentTaskId === filter.parentTaskId);
      }
      if (filter.limit && filter.limit > 0) {
        tasks = tasks.slice(0, filter.limit);
      }
    }

    return tasks;
  }

  async get(taskId: string): Promise<Task | null> {
    const store = await readTaskStore(this.state.deps.storePath);
    return store.tasks.find((t) => t.id === taskId) ?? null;
  }

  async getEvents(taskId: string, limit?: number): Promise<TaskEvent[]> {
    return readTaskEvents(this.state.deps.storePath, taskId, { limit });
  }
}

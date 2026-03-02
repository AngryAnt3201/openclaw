import { describe, expect, it, vi } from "vitest";
import type { Task } from "../tasks/types.js";
import { createNotificationTriggers } from "./triggers.js";

// ---------- helpers ----------

function makeMockNotificationService() {
  return {
    create: vi.fn().mockResolvedValue({ id: "notif-1" }),
  };
}

function makeTriggerDeps() {
  const notificationService = makeMockNotificationService();
  const logs: string[] = [];
  const deps = {
    notificationService:
      notificationService as unknown as import("./service.js").NotificationService,
    log: {
      info: (msg: string) => logs.push(`INFO: ${msg}`),
      warn: (msg: string) => logs.push(`WARN: ${msg}`),
      error: (msg: string) => logs.push(`ERROR: ${msg}`),
    },
  };
  return { deps, notificationService, logs };
}

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "task-1",
    title: "Test Task",
    description: "",
    status: "pending",
    priority: "medium",
    type: "instruction",
    source: "user",
    agentId: "default",
    createdAtMs: 1000000,
    updatedAtMs: 1000000,
    ...overrides,
  } as Task;
}

// ---------- tests ----------

describe("createNotificationTriggers", () => {
  describe("task.created — approval_gate", () => {
    it("sends notification for approval_gate task creation", async () => {
      const { deps, notificationService } = makeTriggerDeps();
      const { handleBroadcastEvent } = createNotificationTriggers(deps);

      const task = makeTask({
        id: "task-gate-1",
        title: "Grant credential access: OpenAI",
        type: "approval_gate",
        agentId: "coder",
      });

      await handleBroadcastEvent("task.created", task);

      expect(notificationService.create).toHaveBeenCalledTimes(1);
      expect(notificationService.create).toHaveBeenCalledWith({
        type: "approval_request",
        title: "Credential access requested",
        body: '"Grant credential access: OpenAI" — an agent is requesting credential access.',
        priority: "critical",
        taskId: "task-gate-1",
        agentId: "coder",
        source: "task.credential_approval",
      });
    });

    it("does NOT send notification for non-approval_gate task creation", async () => {
      const { deps, notificationService } = makeTriggerDeps();
      const { handleBroadcastEvent } = createNotificationTriggers(deps);

      const task = makeTask({
        type: "instruction",
        title: "Normal task",
      });

      await handleBroadcastEvent("task.created", task);

      expect(notificationService.create).not.toHaveBeenCalled();
    });
  });

  describe("task.completed", () => {
    it("sends notification on task completion", async () => {
      const { deps, notificationService } = makeTriggerDeps();
      const { handleBroadcastEvent } = createNotificationTriggers(deps);

      const task = makeTask({
        id: "task-done",
        title: "Finished Work",
        status: "complete",
        agentId: "miranda",
      });

      await handleBroadcastEvent("task.completed", task);

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "task_state_change",
          title: "Task completed",
          taskId: "task-done",
        }),
      );
    });
  });

  describe("task.updated — failed", () => {
    it("sends notification when task fails", async () => {
      const { deps, notificationService } = makeTriggerDeps();
      const { handleBroadcastEvent } = createNotificationTriggers(deps);

      const task = makeTask({
        id: "task-fail",
        title: "Broken Task",
        status: "failed",
        result: { success: false, error: "something went wrong" },
      });

      await handleBroadcastEvent("task.updated", task);

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "task_state_change",
          title: "Task failed",
          priority: "critical",
          taskId: "task-fail",
        }),
      );
    });

    it("does NOT send notification for non-failed task update", async () => {
      const { deps, notificationService } = makeTriggerDeps();
      const { handleBroadcastEvent } = createNotificationTriggers(deps);

      const task = makeTask({ status: "in_progress" });

      await handleBroadcastEvent("task.updated", task);

      expect(notificationService.create).not.toHaveBeenCalled();
    });
  });

  describe("task.approval_required", () => {
    it("sends notification for approval_required tasks", async () => {
      const { deps, notificationService } = makeTriggerDeps();
      const { handleBroadcastEvent } = createNotificationTriggers(deps);

      const task = makeTask({
        id: "task-approve",
        title: "Needs Approval",
        status: "approval_required",
        approvalRequest: {
          id: "req-1",
          toolName: "browser",
          action: "navigate",
          severity: "high",
          reason: "going to admin panel",
          createdAtMs: 1000000,
        },
      });

      await handleBroadcastEvent("task.approval_required", task);

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "approval_request",
          title: "Approval needed",
          priority: "critical",
          taskId: "task-approve",
        }),
      );
    });
  });

  describe("task.input_required", () => {
    it("sends notification for input_required tasks", async () => {
      const { deps, notificationService } = makeTriggerDeps();
      const { handleBroadcastEvent } = createNotificationTriggers(deps);

      const task = makeTask({
        id: "task-input",
        title: "Needs Input",
        status: "input_required",
        inputPrompt: "What color?",
      });

      await handleBroadcastEvent("task.input_required", task);

      expect(notificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "task_state_change",
          title: "Input needed",
          priority: "high",
          taskId: "task-input",
        }),
      );
    });
  });

  describe("error handling", () => {
    it("catches and logs errors from notificationService.create", async () => {
      const { deps, notificationService, logs } = makeTriggerDeps();
      notificationService.create.mockRejectedValue(new Error("db write failed"));
      const { handleBroadcastEvent } = createNotificationTriggers(deps);

      const task = makeTask({ status: "complete" });

      // Should not throw
      await handleBroadcastEvent("task.completed", task);

      expect(logs.some((l) => l.includes("notification trigger failed"))).toBe(true);
    });
  });

  describe("unhandled events", () => {
    it("ignores unknown event types", async () => {
      const { deps, notificationService } = makeTriggerDeps();
      const { handleBroadcastEvent } = createNotificationTriggers(deps);

      await handleBroadcastEvent("task.some_unknown_event", {});

      expect(notificationService.create).not.toHaveBeenCalled();
    });
  });
});

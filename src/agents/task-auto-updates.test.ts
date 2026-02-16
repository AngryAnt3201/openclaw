import { describe, it, expect, beforeEach } from "vitest";
import type { TaskEvent } from "../tasks/types.js";
import { shouldAutoUpdate, clearBuffer, resetAllBuffers } from "./task-auto-updates.js";

function makeEvent(overrides: Partial<TaskEvent> & { taskId: string }): TaskEvent {
  return {
    id: "ev-1",
    type: "tool_use",
    timestamp: Date.now(),
    message: "test event",
    ...overrides,
  };
}

describe("shouldAutoUpdate", () => {
  beforeEach(() => {
    resetAllBuffers();
  });

  it("returns null for a single tool_use event (below threshold)", () => {
    const event = makeEvent({ taskId: "t1", type: "tool_use", data: { toolName: "browser" } });
    const result = shouldAutoUpdate("t1", event, 1000);
    expect(result).toBeNull();
  });

  it("triggers after N tool calls reach threshold", () => {
    for (let i = 0; i < 4; i++) {
      const event = makeEvent({ taskId: "t1", type: "tool_use", data: { toolName: "browser" } });
      expect(shouldAutoUpdate("t1", event, 1000 + i)).toBeNull();
    }
    // 5th call should trigger
    const event = makeEvent({ taskId: "t1", type: "tool_use", data: { toolName: "exec" } });
    const result = shouldAutoUpdate("t1", event, 1005);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("progress");
    expect(result!.title).toBe("5 tool calls completed");
    expect(result!.source).toBe("auto");
    expect(result!.body).toContain("browser");
    expect(result!.body).toContain("exec");
  });

  it("triggers on screenshot event", () => {
    const event = makeEvent({
      taskId: "t1",
      type: "screenshot",
      data: { path: "/tmp/shot.png", url: "https://example.com/page" },
    });
    const result = shouldAutoUpdate("t1", event, 1000);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("screenshot");
    expect(result!.title).toContain("example.com");
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments![0]).toMatchObject({ kind: "screenshot", path: "/tmp/shot.png" });
  });

  it("triggers on error event", () => {
    const event = makeEvent({
      taskId: "t1",
      type: "error",
      data: { error: "Something went wrong", toolName: "exec" },
    });
    const result = shouldAutoUpdate("t1", event, 1000);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("error");
    expect(result!.title).toBe("Error in exec");
    expect(result!.body).toBe("Something went wrong");
  });

  it("respects cooldown interval", () => {
    // First screenshot triggers
    const event1 = makeEvent({ taskId: "t1", type: "screenshot", data: { path: "/tmp/a.png" } });
    expect(shouldAutoUpdate("t1", event1, 1000)).not.toBeNull();

    // Second screenshot within 30s should not trigger
    const event2 = makeEvent({ taskId: "t1", type: "screenshot", data: { path: "/tmp/b.png" } });
    expect(shouldAutoUpdate("t1", event2, 15000)).toBeNull();

    // After 30s should trigger again
    const event3 = makeEvent({ taskId: "t1", type: "screenshot", data: { path: "/tmp/c.png" } });
    expect(shouldAutoUpdate("t1", event3, 32000)).not.toBeNull();
  });

  it("accumulates tool calls during cooldown", () => {
    // Trigger a screenshot first to start cooldown
    const shot = makeEvent({ taskId: "t1", type: "screenshot", data: { path: "/tmp/a.png" } });
    shouldAutoUpdate("t1", shot, 1000);

    // Add tool calls during cooldown
    for (let i = 0; i < 5; i++) {
      const event = makeEvent({ taskId: "t1", type: "tool_use", data: { toolName: "browser" } });
      shouldAutoUpdate("t1", event, 2000 + i);
    }

    // After cooldown, next tool call should trigger with accumulated tools
    const event = makeEvent({ taskId: "t1", type: "tool_use", data: { toolName: "exec" } });
    const result = shouldAutoUpdate("t1", event, 32000);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("progress");
    // 5 from cooldown + 1 new = 6
    expect(result!.title).toBe("6 tool calls completed");
  });

  it("clearBuffer resets state for a task", () => {
    // Accumulate 4 tool calls
    for (let i = 0; i < 4; i++) {
      const event = makeEvent({ taskId: "t1", type: "tool_use", data: { toolName: "browser" } });
      shouldAutoUpdate("t1", event, 1000 + i);
    }

    clearBuffer("t1");

    // Should need full threshold again
    const event = makeEvent({ taskId: "t1", type: "tool_use", data: { toolName: "browser" } });
    expect(shouldAutoUpdate("t1", event, 2000)).toBeNull();
  });

  it("returns null for unhandled event types", () => {
    const event = makeEvent({ taskId: "t1", type: "navigation" as TaskEvent["type"] });
    expect(shouldAutoUpdate("t1", event, 1000)).toBeNull();
  });

  it("handles error event without toolName", () => {
    const event = makeEvent({
      taskId: "t1",
      type: "error",
      data: { error: "Unknown failure" },
    });
    const result = shouldAutoUpdate("t1", event, 1000);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Error encountered");
  });

  it("tool call summary groups duplicate tools", () => {
    for (let i = 0; i < 4; i++) {
      const event = makeEvent({ taskId: "t1", type: "tool_use", data: { toolName: "browser" } });
      shouldAutoUpdate("t1", event, 1000 + i);
    }
    const event = makeEvent({ taskId: "t1", type: "tool_use", data: { toolName: "browser" } });
    const result = shouldAutoUpdate("t1", event, 1005);
    expect(result).not.toBeNull();
    expect(result!.body).toContain("browser (x5)");
  });
});

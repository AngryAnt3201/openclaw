import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTaskEvents } from "../tasks/store.js";
import {
  bindSessionToTask,
  unbindSession,
  getSessionTask,
  resetBindingsForTest,
  captureToolEvent,
  captureNavigationEvent,
  captureScreenshotEvent,
  captureOutputEvent,
  captureErrorEvent,
} from "./task-monitor.js";

let tmpDir: string;
let storePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "task-monitor-"));
  storePath = path.join(tmpDir, "store.json");
  resetBindingsForTest();
});

afterEach(async () => {
  resetBindingsForTest();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Session → Task binding
// ---------------------------------------------------------------------------

describe("session binding", () => {
  it("binds a session to a task", () => {
    bindSessionToTask("session-1", "task-1", storePath);
    const result = getSessionTask("session-1");
    expect(result).toEqual({ taskId: "task-1", storePath });
  });

  it("returns null for unbound session", () => {
    expect(getSessionTask("no-session")).toBeNull();
  });

  it("unbinds a session", () => {
    bindSessionToTask("session-1", "task-1", storePath);
    unbindSession("session-1");
    expect(getSessionTask("session-1")).toBeNull();
  });

  it("overwrites binding for same session", () => {
    bindSessionToTask("session-1", "task-1", storePath);
    bindSessionToTask("session-1", "task-2", storePath);
    expect(getSessionTask("session-1")?.taskId).toBe("task-2");
  });

  it("supports multiple sessions", () => {
    bindSessionToTask("session-1", "task-1", storePath);
    bindSessionToTask("session-2", "task-2", storePath);
    expect(getSessionTask("session-1")?.taskId).toBe("task-1");
    expect(getSessionTask("session-2")?.taskId).toBe("task-2");
  });

  it("resetBindingsForTest clears all bindings", () => {
    bindSessionToTask("session-1", "task-1", storePath);
    bindSessionToTask("session-2", "task-2", storePath);
    resetBindingsForTest();
    expect(getSessionTask("session-1")).toBeNull();
    expect(getSessionTask("session-2")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// captureToolEvent
// ---------------------------------------------------------------------------

describe("captureToolEvent", () => {
  it("returns null for unbound session", async () => {
    const result = await captureToolEvent({
      sessionKey: "no-session",
      toolName: "browser",
    });
    expect(result).toBeNull();
  });

  it("captures a tool invocation event", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const event = await captureToolEvent({
      sessionKey: "s1",
      toolName: "browser",
      toolParams: { action: "navigate", url: "https://example.com" },
      durationMs: 1234,
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe("tool_use");
    expect(event!.taskId).toBe("t1");
    expect(event!.message).toContain("browser");
    expect(event!.message).toContain("1234ms");
    expect(event!.data?.toolName).toBe("browser");
    expect(event!.data?.durationMs).toBe(1234);
  });

  it("writes event to the task event log", async () => {
    bindSessionToTask("s1", "t1", storePath);

    await captureToolEvent({
      sessionKey: "s1",
      toolName: "exec",
      toolParams: { command: "ls" },
      durationMs: 50,
    });

    const events = await readTaskEvents(storePath, "t1");
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("tool_use");
    expect(events[0]!.data?.toolName).toBe("exec");
  });

  it("captures error in tool invocation", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const event = await captureToolEvent({
      sessionKey: "s1",
      toolName: "browser",
      error: "Connection timeout",
      durationMs: 5000,
    });

    expect(event!.message).toContain("failed");
    expect(event!.message).toContain("Connection timeout");
  });

  it("redacts sensitive parameters", async () => {
    bindSessionToTask("s1", "t1", storePath);

    await captureToolEvent({
      sessionKey: "s1",
      toolName: "api",
      toolParams: {
        url: "https://example.com",
        token: "secret-token-123",
        password: "my-password",
        data: "visible",
      },
    });

    const events = await readTaskEvents(storePath, "t1");
    const params = events[0]!.data?.params as Record<string, unknown>;
    expect(params.url).toBe("https://example.com");
    expect(params.token).toBe("[REDACTED]");
    expect(params.password).toBe("[REDACTED]");
    expect(params.data).toBe("visible");
  });

  it("truncates very long parameter values", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const longValue = "x".repeat(1000);
    await captureToolEvent({
      sessionKey: "s1",
      toolName: "exec",
      toolParams: { command: longValue },
    });

    const events = await readTaskEvents(storePath, "t1");
    const params = events[0]!.data?.params as Record<string, unknown>;
    const truncated = params.command as string;
    expect(truncated.length).toBeLessThan(510);
    expect(truncated.endsWith("...")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// captureNavigationEvent
// ---------------------------------------------------------------------------

describe("captureNavigationEvent", () => {
  it("returns null for unbound session", async () => {
    const result = await captureNavigationEvent({
      sessionKey: "no-session",
      url: "https://example.com",
    });
    expect(result).toBeNull();
  });

  it("captures a navigation event", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const event = await captureNavigationEvent({
      sessionKey: "s1",
      url: "https://example.com/dashboard",
      title: "Dashboard",
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe("navigation");
    expect(event!.message).toContain("https://example.com/dashboard");
    expect(event!.message).toContain("Dashboard");
    expect(event!.data?.url).toBe("https://example.com/dashboard");
    expect(event!.data?.title).toBe("Dashboard");
  });

  it("works without a page title", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const event = await captureNavigationEvent({
      sessionKey: "s1",
      url: "https://example.com",
    });

    expect(event!.message).toContain("https://example.com");
    expect(event!.data?.title).toBeUndefined();
  });

  it("persists to event log", async () => {
    bindSessionToTask("s1", "t1", storePath);

    await captureNavigationEvent({
      sessionKey: "s1",
      url: "https://example.com",
    });

    const events = await readTaskEvents(storePath, "t1");
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("navigation");
  });
});

// ---------------------------------------------------------------------------
// captureScreenshotEvent
// ---------------------------------------------------------------------------

describe("captureScreenshotEvent", () => {
  it("returns null for unbound session", async () => {
    const result = await captureScreenshotEvent({
      sessionKey: "no-session",
      sourcePath: "/tmp/screenshot.png",
    });
    expect(result).toBeNull();
  });

  it("captures a screenshot event and copies file", async () => {
    bindSessionToTask("s1", "t1", storePath);

    // Create a fake screenshot file
    const screenshotSource = path.join(tmpDir, "source-screenshot.png");
    await fs.writeFile(screenshotSource, "fake-png-data");

    const event = await captureScreenshotEvent({
      sessionKey: "s1",
      sourcePath: screenshotSource,
      url: "https://example.com",
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe("screenshot");
    expect(event!.message).toContain("Screenshot captured");
    expect(event!.message).toContain("https://example.com");
    expect(event!.data?.url).toBe("https://example.com");
    expect(typeof event!.data?.path).toBe("string");

    // Verify the screenshot was copied
    const destPath = event!.data?.path as string;
    const exists = await fs.stat(destPath).then(
      () => true,
      () => false,
    );
    expect(exists).toBe(true);
  });

  it("handles missing source file gracefully", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const event = await captureScreenshotEvent({
      sessionKey: "s1",
      sourcePath: "/nonexistent/screenshot.png",
    });

    // Event should still be logged even if copy fails
    expect(event).not.toBeNull();
    expect(event!.type).toBe("screenshot");
  });

  it("preserves file extension", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const screenshotSource = path.join(tmpDir, "test.jpeg");
    await fs.writeFile(screenshotSource, "fake-jpeg-data");

    const event = await captureScreenshotEvent({
      sessionKey: "s1",
      sourcePath: screenshotSource,
    });

    const destPath = event!.data?.path as string;
    expect(destPath.endsWith(".jpeg")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// captureOutputEvent
// ---------------------------------------------------------------------------

describe("captureOutputEvent", () => {
  it("returns null for unbound session", async () => {
    const result = await captureOutputEvent({
      sessionKey: "no-session",
      text: "Hello",
    });
    expect(result).toBeNull();
  });

  it("captures an output event", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const event = await captureOutputEvent({
      sessionKey: "s1",
      text: "Task completed successfully",
    });

    expect(event!.type).toBe("output");
    expect(event!.message).toBe("Task completed successfully");
    expect(event!.data?.text).toBe("Task completed successfully");
  });

  it("truncates long messages", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const longText = "x".repeat(500);
    const event = await captureOutputEvent({
      sessionKey: "s1",
      text: longText,
    });

    expect(event!.message.length).toBeLessThanOrEqual(203);
    expect(event!.message.endsWith("...")).toBe(true);
    // Full text is preserved in data
    expect(event!.data?.text).toBe(longText);
  });
});

// ---------------------------------------------------------------------------
// captureErrorEvent
// ---------------------------------------------------------------------------

describe("captureErrorEvent", () => {
  it("returns null for unbound session", async () => {
    const result = await captureErrorEvent({
      sessionKey: "no-session",
      error: "Something broke",
    });
    expect(result).toBeNull();
  });

  it("captures an error event with tool name", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const event = await captureErrorEvent({
      sessionKey: "s1",
      error: "Connection refused",
      toolName: "browser",
    });

    expect(event!.type).toBe("error");
    expect(event!.message).toContain("browser");
    expect(event!.message).toContain("Connection refused");
    expect(event!.data?.error).toBe("Connection refused");
    expect(event!.data?.toolName).toBe("browser");
  });

  it("captures an error event without tool name", async () => {
    bindSessionToTask("s1", "t1", storePath);

    const event = await captureErrorEvent({
      sessionKey: "s1",
      error: "Unknown error",
    });

    expect(event!.message).toBe("Error: Unknown error");
    expect(event!.data?.toolName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multi-event scenarios
// ---------------------------------------------------------------------------

describe("multi-event scenarios", () => {
  it("captures multiple events for the same task", async () => {
    bindSessionToTask("s1", "t1", storePath);

    await captureToolEvent({
      sessionKey: "s1",
      toolName: "browser",
      toolParams: { action: "navigate" },
      durationMs: 100,
    });

    await captureNavigationEvent({
      sessionKey: "s1",
      url: "https://example.com",
    });

    await captureOutputEvent({
      sessionKey: "s1",
      text: "Page loaded",
    });

    const events = await readTaskEvents(storePath, "t1");
    expect(events).toHaveLength(3);
    expect(events[0]!.type).toBe("tool_use");
    expect(events[1]!.type).toBe("navigation");
    expect(events[2]!.type).toBe("output");
  });

  it("routes events to correct tasks by session", async () => {
    const storePath2 = path.join(tmpDir, "store2.json");

    bindSessionToTask("s1", "task-A", storePath);
    bindSessionToTask("s2", "task-B", storePath2);

    await captureToolEvent({
      sessionKey: "s1",
      toolName: "exec",
      durationMs: 10,
    });

    await captureToolEvent({
      sessionKey: "s2",
      toolName: "browser",
      durationMs: 20,
    });

    const eventsA = await readTaskEvents(storePath, "task-A");
    const eventsB = await readTaskEvents(storePath2, "task-B");

    expect(eventsA).toHaveLength(1);
    expect(eventsA[0]!.data?.toolName).toBe("exec");

    expect(eventsB).toHaveLength(1);
    expect(eventsB[0]!.data?.toolName).toBe("browser");
  });

  it("no events after unbinding", async () => {
    bindSessionToTask("s1", "t1", storePath);

    await captureToolEvent({
      sessionKey: "s1",
      toolName: "exec",
      durationMs: 10,
    });

    unbindSession("s1");

    const result = await captureToolEvent({
      sessionKey: "s1",
      toolName: "browser",
      durationMs: 20,
    });

    expect(result).toBeNull();

    const events = await readTaskEvents(storePath, "t1");
    expect(events).toHaveLength(1); // Only the first event
  });

  it("all events have valid structure", async () => {
    bindSessionToTask("s1", "t1", storePath);

    await captureToolEvent({ sessionKey: "s1", toolName: "exec", durationMs: 10 });
    await captureNavigationEvent({ sessionKey: "s1", url: "https://example.com" });
    await captureOutputEvent({ sessionKey: "s1", text: "hello" });
    await captureErrorEvent({ sessionKey: "s1", error: "oops" });

    const events = await readTaskEvents(storePath, "t1");
    for (const event of events) {
      expect(event.id).toBeTruthy();
      expect(event.taskId).toBe("t1");
      expect(typeof event.type).toBe("string");
      expect(typeof event.timestamp).toBe("number");
      expect(event.timestamp).toBeGreaterThan(0);
      expect(typeof event.message).toBe("string");
      expect(event.message.length).toBeGreaterThan(0);
    }
  });
});

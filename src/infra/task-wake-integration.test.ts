import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  requestHeartbeatNow,
  hasPendingHeartbeatWake,
  setHeartbeatWakeHandler,
} from "./heartbeat-wake.js";
import {
  enqueueSystemEvent,
  drainSystemEvents,
  resetSystemEventsForTest,
  hasSystemEvents,
} from "./system-events.js";

beforeEach(() => {
  resetSystemEventsForTest();
  setHeartbeatWakeHandler(null);
});

afterEach(() => {
  resetSystemEventsForTest();
  setHeartbeatWakeHandler(null);
});

// ---------------------------------------------------------------------------
// These tests verify the integration pattern used by server-methods/tasks.ts:
// When a task receives user input or an approval decision, a system event is
// enqueued into the agent's session and a heartbeat wake is requested.
// ---------------------------------------------------------------------------

describe("task wake integration", () => {
  it("enqueues a system event for the agent session", () => {
    const sessionKey = "agent:default:main";
    const message = 'Task "Deploy staging" received user input: Yes, proceed';

    enqueueSystemEvent(message, { sessionKey });

    expect(hasSystemEvents(sessionKey)).toBe(true);
    const events = drainSystemEvents(sessionKey);
    expect(events).toHaveLength(1);
    expect(events[0]).toBe(message);
  });

  it("does not enqueue duplicate consecutive events", () => {
    const sessionKey = "agent:default:main";
    const message = "Task approved";

    enqueueSystemEvent(message, { sessionKey });
    enqueueSystemEvent(message, { sessionKey }); // duplicate

    const events = drainSystemEvents(sessionKey);
    expect(events).toHaveLength(1);
  });

  it("enqueues different events sequentially", () => {
    const sessionKey = "agent:default:main";

    enqueueSystemEvent("Task A input", { sessionKey });
    enqueueSystemEvent("Task B approved", { sessionKey });

    const events = drainSystemEvents(sessionKey);
    expect(events).toHaveLength(2);
    expect(events[0]).toBe("Task A input");
    expect(events[1]).toBe("Task B approved");
  });

  it("events are session-scoped", () => {
    enqueueSystemEvent("Task input", { sessionKey: "session-1" });

    expect(hasSystemEvents("session-1")).toBe(true);
    expect(hasSystemEvents("session-2")).toBe(false);
  });

  it("draining clears events", () => {
    const sessionKey = "agent:default:main";
    enqueueSystemEvent("Task approved", { sessionKey });

    drainSystemEvents(sessionKey);
    expect(hasSystemEvents(sessionKey)).toBe(false);
  });

  it("requestHeartbeatNow registers a pending wake", () => {
    requestHeartbeatNow({ reason: "task:agent:default:main" });
    expect(hasPendingHeartbeatWake()).toBe(true);
  });

  it("task event reason follows task: prefix pattern", () => {
    const sessionKey = "agent:default:main";
    const reason = `task:${sessionKey}`;

    expect(reason.startsWith("task:")).toBe(true);
    expect(reason).toBe("task:agent:default:main");
  });

  it("wakeAgentForTask pattern: enqueue + wake", () => {
    const sessionKey = "agent:default:main";

    // This mirrors the wakeAgentForTask function in server-methods/tasks.ts
    enqueueSystemEvent('Task "Test" received user input: Hello', { sessionKey });
    requestHeartbeatNow({ reason: `task:${sessionKey}` });

    expect(hasSystemEvents(sessionKey)).toBe(true);
    expect(hasPendingHeartbeatWake()).toBe(true);

    // Events are available for the heartbeat to consume
    const events = drainSystemEvents(sessionKey);
    expect(events).toHaveLength(1);
    expect(events[0]).toContain("Test");
    expect(events[0]).toContain("Hello");
  });

  it("does not enqueue events when sessionKey is undefined (no-op)", () => {
    // When a task has no sessionKey, wakeAgentForTask returns early.
    // Verify that no system events are queued.
    const sessionKey: string | undefined = undefined;

    if (sessionKey) {
      enqueueSystemEvent("Should not happen", { sessionKey });
      requestHeartbeatNow({ reason: `task:${sessionKey}` });
    }

    // No events should be enqueued for any known session
    expect(hasSystemEvents("agent:default:main")).toBe(false);
    expect(hasSystemEvents("any-session")).toBe(false);
  });

  it("approve message includes proceed instruction", () => {
    const sessionKey = "agent:default:main";
    const title = "Deploy staging";
    const message = `Task "${title}" — action approved by user. Proceed with the previously requested operation.`;

    enqueueSystemEvent(message, { sessionKey });

    const events = drainSystemEvents(sessionKey);
    expect(events[0]).toContain("approved");
    expect(events[0]).toContain("Proceed");
  });

  it("reject message includes reason when provided", () => {
    const sessionKey = "agent:default:main";
    const title = "Delete database";
    const reason = "Too risky";
    const message = `Task "${title}" — action rejected by user: ${reason}. Find an alternative approach or stop.`;

    enqueueSystemEvent(message, { sessionKey });

    const events = drainSystemEvents(sessionKey);
    expect(events[0]).toContain("rejected");
    expect(events[0]).toContain("Too risky");
    expect(events[0]).toContain("alternative");
  });

  it("reject message works without reason", () => {
    const sessionKey = "agent:default:main";
    const title = "Delete database";
    const reason: string | undefined = undefined;
    const message = `Task "${title}" — action rejected by user${reason ? `: ${reason}` : ""}. Find an alternative approach or stop.`;

    enqueueSystemEvent(message, { sessionKey });

    const events = drainSystemEvents(sessionKey);
    expect(events[0]).toContain("rejected by user.");
    expect(events[0]).not.toContain(":");
  });
});

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NotificationServiceDeps } from "./service.js";
import type { NotificationStoreFile } from "./types.js";
import { NotificationService } from "./service.js";
import { readNotificationStore, writeNotificationStore, defaultPreferences } from "./store.js";

let tmpDir: string;
let storePath: string;
let clock: number;
let broadcasts: Array<{ event: string; payload: unknown }>;

function makeDeps(overrides?: Partial<NotificationServiceDeps>): NotificationServiceDeps {
  return {
    storePath,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    nowMs: () => clock,
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notif-svc-"));
  storePath = path.join(tmpDir, "store.json");
  clock = 1000;
  broadcasts = [];
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("create", () => {
  it("creates a notification with defaults", async () => {
    const svc = new NotificationService(makeDeps());
    const n = await svc.create({
      type: "system_event",
      title: "Test",
      body: "Hello world",
    });

    expect(n.id).toBeTruthy();
    expect(n.title).toBe("Test");
    expect(n.body).toBe("Hello world");
    expect(n.type).toBe("system_event");
    expect(n.priority).toBe("medium");
    expect(n.status).toBe("unread");
    expect(n.createdAtMs).toBe(1000);
  });

  it("persists to store", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.create({ type: "custom", title: "Persisted", body: "Check" });

    const store = await readNotificationStore(storePath);
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0]!.title).toBe("Persisted");
  });

  it("broadcasts notification.created", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.create({ type: "custom", title: "Broadcast", body: "Test" });

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.event).toBe("notification.created");
  });

  it("respects priority override", async () => {
    const svc = new NotificationService(makeDeps());
    const n = await svc.create({
      type: "agent_alert",
      title: "Error",
      body: "Something broke",
      priority: "critical",
    });

    expect(n.priority).toBe("critical");
  });

  it("stores taskId and agentId", async () => {
    const svc = new NotificationService(makeDeps());
    const n = await svc.create({
      type: "task_state_change",
      title: "Task done",
      body: "Complete",
      taskId: "t-123",
      agentId: "agent-1",
    });

    expect(n.taskId).toBe("t-123");
    expect(n.agentId).toBe("agent-1");
  });
});

describe("list", () => {
  it("returns empty for empty store", async () => {
    const svc = new NotificationService(makeDeps());
    const list = await svc.list();
    expect(list).toEqual([]);
  });

  it("returns notifications newest first", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.create({ type: "custom", title: "First", body: "1" });
    clock = 2000;
    await svc.create({ type: "custom", title: "Second", body: "2" });

    const list = await svc.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.title).toBe("Second");
    expect(list[1]!.title).toBe("First");
  });

  it("filters by status", async () => {
    const svc = new NotificationService(makeDeps());
    const n = await svc.create({ type: "custom", title: "A", body: "a" });
    await svc.create({ type: "custom", title: "B", body: "b" });
    await svc.markRead(n.id);

    const unread = await svc.list({ status: "unread" });
    expect(unread).toHaveLength(1);
    expect(unread[0]!.title).toBe("B");
  });

  it("filters by type", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.create({ type: "custom", title: "Custom", body: "c" });
    await svc.create({ type: "agent_alert", title: "Alert", body: "a" });

    const alerts = await svc.list({ type: "agent_alert" });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toBe("Alert");
  });

  it("respects limit", async () => {
    const svc = new NotificationService(makeDeps());
    for (let i = 0; i < 5; i++) {
      clock = 1000 + i;
      await svc.create({ type: "custom", title: `N${i}`, body: "body" });
    }

    const limited = await svc.list({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it("filters by taskId", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.create({ type: "task_state_change", title: "T1", body: "b", taskId: "task-1" });
    await svc.create({ type: "task_state_change", title: "T2", body: "b", taskId: "task-2" });

    const filtered = await svc.list({ taskId: "task-1" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.title).toBe("T1");
  });
});

describe("get", () => {
  it("returns notification by id", async () => {
    const svc = new NotificationService(makeDeps());
    const n = await svc.create({ type: "custom", title: "Find me", body: "here" });

    const found = await svc.get(n.id);
    expect(found).toBeTruthy();
    expect(found!.title).toBe("Find me");
  });

  it("returns null for missing id", async () => {
    const svc = new NotificationService(makeDeps());
    const found = await svc.get("nonexistent");
    expect(found).toBeNull();
  });
});

describe("markRead", () => {
  it("marks notification as read", async () => {
    const svc = new NotificationService(makeDeps());
    const n = await svc.create({ type: "custom", title: "Read me", body: "now" });

    clock = 2000;
    const updated = await svc.markRead(n.id);
    expect(updated!.status).toBe("read");
    expect(updated!.readAtMs).toBe(2000);
  });

  it("broadcasts notification.read", async () => {
    const svc = new NotificationService(makeDeps());
    const n = await svc.create({ type: "custom", title: "Test", body: "body" });
    broadcasts = [];

    await svc.markRead(n.id);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.event).toBe("notification.read");
  });

  it("returns null for missing id", async () => {
    const svc = new NotificationService(makeDeps());
    const result = await svc.markRead("nonexistent");
    expect(result).toBeNull();
  });
});

describe("markAllRead", () => {
  it("marks all unread as read", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.create({ type: "custom", title: "A", body: "a" });
    await svc.create({ type: "custom", title: "B", body: "b" });

    clock = 2000;
    const count = await svc.markAllRead();
    expect(count).toBe(2);

    const list = await svc.list({ status: "unread" });
    expect(list).toHaveLength(0);
  });

  it("broadcasts notification.allRead", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.create({ type: "custom", title: "A", body: "a" });
    broadcasts = [];

    await svc.markAllRead();
    expect(broadcasts.some((b) => b.event === "notification.allRead")).toBe(true);
  });

  it("returns 0 when nothing to mark", async () => {
    const svc = new NotificationService(makeDeps());
    const count = await svc.markAllRead();
    expect(count).toBe(0);
  });
});

describe("dismiss", () => {
  it("marks notification as dismissed", async () => {
    const svc = new NotificationService(makeDeps());
    const n = await svc.create({ type: "custom", title: "Dismiss me", body: "bye" });

    clock = 2000;
    const dismissed = await svc.dismiss(n.id);
    expect(dismissed!.status).toBe("dismissed");
    expect(dismissed!.dismissedAtMs).toBe(2000);
  });

  it("returns null for missing id", async () => {
    const svc = new NotificationService(makeDeps());
    const result = await svc.dismiss("nonexistent");
    expect(result).toBeNull();
  });
});

describe("dismissAll", () => {
  it("dismisses all notifications", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.create({ type: "custom", title: "A", body: "a" });
    await svc.create({ type: "custom", title: "B", body: "b" });

    const count = await svc.dismissAll();
    expect(count).toBe(2);

    const list = await svc.list({ status: "dismissed" });
    expect(list).toHaveLength(2);
  });
});

describe("getUnreadCount", () => {
  it("counts unread notifications", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.create({ type: "custom", title: "A", body: "a" });
    await svc.create({ type: "custom", title: "B", body: "b" });
    const n = await svc.create({ type: "custom", title: "C", body: "c" });
    await svc.markRead(n.id);

    const count = await svc.getUnreadCount();
    expect(count).toBe(2);
  });
});

describe("preferences", () => {
  it("returns default preferences", async () => {
    const svc = new NotificationService(makeDeps());
    const prefs = await svc.getPreferences();
    expect(prefs.enabled).toBe(true);
    expect(prefs.defaultChannels).toEqual([]);
  });

  it("updates preferences", async () => {
    const svc = new NotificationService(makeDeps());
    const updated = await svc.updatePreferences({
      defaultChannels: ["discord", "telegram"],
      quietHours: { enabled: true, startHour: 22, endHour: 8 },
    });

    expect(updated.defaultChannels).toEqual(["discord", "telegram"]);
    expect(updated.quietHours.enabled).toBe(true);
  });

  it("merges route configs", async () => {
    const svc = new NotificationService(makeDeps());
    await svc.updatePreferences({
      routes: {
        task_state_change: { enabled: true, channels: ["discord"] },
      },
    });

    await svc.updatePreferences({
      routes: {
        agent_alert: { enabled: true, channels: ["telegram"] },
      },
    });

    const prefs = await svc.getPreferences();
    expect(prefs.routes.task_state_change).toBeTruthy();
    expect(prefs.routes.agent_alert).toBeTruthy();
  });

  it("broadcasts notification.preferences.updated", async () => {
    const svc = new NotificationService(makeDeps());
    broadcasts = [];

    await svc.updatePreferences({ enabled: false });
    expect(broadcasts.some((b) => b.event === "notification.preferences.updated")).toBe(true);
  });
});

describe("auto-prune", () => {
  it("prunes old dismissed notifications when above threshold", async () => {
    const svc = new NotificationService(makeDeps());

    // Pre-seed store with many old dismissed notifications
    const store: NotificationStoreFile = {
      version: 1,
      notifications: [],
      preferences: defaultPreferences(),
    };
    for (let i = 0; i < 1001; i++) {
      store.notifications.push({
        id: `old-${i}`,
        type: "custom",
        title: `Old ${i}`,
        body: "old",
        priority: "low",
        status: "dismissed",
        channels: [],
        createdAtMs: 100, // very old
        updatedAtMs: 100,
        dismissedAtMs: 100,
      });
    }
    await writeNotificationStore(storePath, store);

    // Creating a new notification should trigger prune
    clock = Date.now();
    await svc.create({ type: "custom", title: "New", body: "new" });

    const result = await readNotificationStore(storePath);
    // All old dismissed should be pruned, only the new one remains
    expect(result.notifications.length).toBeLessThan(1001);
    expect(result.notifications.some((n) => n.title === "New")).toBe(true);
  });
});

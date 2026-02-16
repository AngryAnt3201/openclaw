import { describe, it, expect, vi } from "vitest";
import type { DispatchDeps, NodeInvoker } from "./dispatch.js";
import type { Notification, NotificationPreferences } from "./types.js";
import { isInQuietHours, resolveChannels, dispatchNotification } from "./dispatch.js";
import { defaultPreferences } from "./store.js";

function makeNotification(overrides?: Partial<Notification>): Notification {
  return {
    id: "n-1",
    type: "system_event",
    title: "Test",
    body: "Body",
    priority: "medium",
    status: "unread",
    channels: [],
    createdAtMs: 1000,
    updatedAtMs: 1000,
    ...overrides,
  };
}

describe("isInQuietHours", () => {
  it("returns false when disabled", () => {
    expect(isInQuietHours({ enabled: false, startHour: 22, endHour: 8 })).toBe(false);
  });

  it("detects overnight quiet hours (22-8)", () => {
    // 23:00 → in quiet hours
    const at23 = new Date();
    at23.setHours(23, 0, 0, 0);
    expect(isInQuietHours({ enabled: true, startHour: 22, endHour: 8 }, at23.getTime())).toBe(true);

    // 3:00 → in quiet hours
    const at3 = new Date();
    at3.setHours(3, 0, 0, 0);
    expect(isInQuietHours({ enabled: true, startHour: 22, endHour: 8 }, at3.getTime())).toBe(true);

    // 12:00 → not in quiet hours
    const at12 = new Date();
    at12.setHours(12, 0, 0, 0);
    expect(isInQuietHours({ enabled: true, startHour: 22, endHour: 8 }, at12.getTime())).toBe(
      false,
    );
  });

  it("detects daytime quiet hours (8-18)", () => {
    const at10 = new Date();
    at10.setHours(10, 0, 0, 0);
    expect(isInQuietHours({ enabled: true, startHour: 8, endHour: 18 }, at10.getTime())).toBe(true);

    const at20 = new Date();
    at20.setHours(20, 0, 0, 0);
    expect(isInQuietHours({ enabled: true, startHour: 8, endHour: 18 }, at20.getTime())).toBe(
      false,
    );
  });
});

describe("resolveChannels", () => {
  it("returns empty when preferences disabled", () => {
    const prefs: NotificationPreferences = { ...defaultPreferences(), enabled: false };
    const result = resolveChannels(makeNotification(), prefs);
    expect(result).toEqual([]);
  });

  it("uses explicit channels when provided", () => {
    const result = resolveChannels(makeNotification(), defaultPreferences(), [
      "discord",
      "telegram",
    ]);
    expect(result).toEqual(["discord", "telegram"]);
  });

  it("uses per-type route config", () => {
    const prefs: NotificationPreferences = {
      ...defaultPreferences(),
      routes: {
        system_event: { enabled: true, channels: ["slack"] },
      },
    };
    const result = resolveChannels(makeNotification({ type: "system_event" }), prefs);
    expect(result).toEqual(["slack"]);
  });

  it("returns empty when route is disabled", () => {
    const prefs: NotificationPreferences = {
      ...defaultPreferences(),
      routes: {
        system_event: { enabled: false, channels: ["slack"] },
      },
    };
    const result = resolveChannels(makeNotification({ type: "system_event" }), prefs);
    expect(result).toEqual([]);
  });

  it("filters by minimum priority", () => {
    const prefs: NotificationPreferences = {
      ...defaultPreferences(),
      routes: {
        system_event: { enabled: true, channels: ["discord"], minPriority: "high" },
      },
    };

    // medium < high → filtered out
    const low = resolveChannels(makeNotification({ priority: "medium" }), prefs);
    expect(low).toEqual([]);

    // critical >= high → included
    const high = resolveChannels(makeNotification({ priority: "critical" }), prefs);
    expect(high).toEqual(["discord"]);
  });

  it("falls back to default channels", () => {
    const prefs: NotificationPreferences = {
      ...defaultPreferences(),
      defaultChannels: ["telegram"],
    };
    const result = resolveChannels(makeNotification(), prefs);
    expect(result).toEqual(["telegram"]);
  });
});

describe("dispatchNotification", () => {
  it("dispatches to native channels", async () => {
    const deliverOutbound = vi.fn().mockResolvedValue([]);
    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: { discord: "channel-123" },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      deliverOutbound,
    };

    const notification = makeNotification();
    const results = await dispatchNotification(
      deps,
      notification,
      ["discord"],
      defaultPreferences(),
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
    expect(deliverOutbound).toHaveBeenCalledOnce();
  });

  it("reports failure when no target configured", async () => {
    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: {},
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      deliverOutbound: vi.fn(),
    };

    const results = await dispatchNotification(
      deps,
      makeNotification(),
      ["discord"],
      defaultPreferences(),
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toContain("no target configured");
  });

  it("suppresses dispatch during quiet hours for non-critical", async () => {
    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: { discord: "ch-1" },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      deliverOutbound: vi.fn(),
    };

    const quietPrefs: NotificationPreferences = {
      ...defaultPreferences(),
      quietHours: { enabled: true, startHour: 0, endHour: 23 }, // always quiet
    };

    const results = await dispatchNotification(
      deps,
      makeNotification({ priority: "medium" }),
      ["discord"],
      quietPrefs,
    );

    expect(results).toEqual([]);
  });

  it("allows critical during quiet hours", async () => {
    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: { discord: "ch-1" },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      deliverOutbound: vi.fn().mockResolvedValue([]),
    };

    const quietPrefs: NotificationPreferences = {
      ...defaultPreferences(),
      quietHours: { enabled: true, startHour: 0, endHour: 23 },
    };

    const results = await dispatchNotification(
      deps,
      makeNotification({ priority: "critical" }),
      ["discord"],
      quietPrefs,
    );

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(true);
  });

  it("dispatches to webhooks", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: {},
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };

    const prefs: NotificationPreferences = {
      ...defaultPreferences(),
      webhooks: [{ url: "https://example.com/hook", enabled: true }],
    };

    const results = await dispatchNotification(deps, makeNotification(), [], prefs);

    expect(results).toHaveLength(1);
    expect(results[0]!.channel).toBe("webhook");
    expect(results[0]!.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();

    fetchSpy.mockRestore();
  });

  it("dispatches to connected nodes with system.notify", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const nodeInvoker: NodeInvoker = {
      listConnectedNodes: () => [
        { nodeId: "iphone-1", commands: ["system.notify", "system.haptic"], platform: "ios" },
        { nodeId: "linux-1", commands: ["system.exec"], platform: "linux" },
      ],
      invoke,
    };

    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: {},
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      nodeInvoker,
    };

    const notification = makeNotification({ id: "n-node-1", title: "Hello", body: "World" });
    const results = await dispatchNotification(deps, notification, [], defaultPreferences());

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith({
      nodeId: "iphone-1",
      command: "system.notify",
      params: { title: "Hello", body: "World", priority: "active", delivery: "system" },
      timeoutMs: 10_000,
      idempotencyKey: "notif-n-node-1-iphone-1",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.channel).toBe("node:iphone-1");
    expect(results[0]!.success).toBe(true);
  });

  it("skips node push when nodePushEnabled is false", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const nodeInvoker: NodeInvoker = {
      listConnectedNodes: () => [
        { nodeId: "iphone-1", commands: ["system.notify"], platform: "ios" },
      ],
      invoke,
    };

    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: {},
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      nodeInvoker,
    };

    const prefs: NotificationPreferences = { ...defaultPreferences(), nodePushEnabled: false };
    const results = await dispatchNotification(deps, makeNotification(), [], prefs);

    expect(invoke).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("maps priority correctly for node push", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const nodeInvoker: NodeInvoker = {
      listConnectedNodes: () => [
        { nodeId: "mac-1", commands: ["system.notify"], platform: "macos" },
      ],
      invoke,
    };

    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: {},
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      nodeInvoker,
    };

    const mapping: Array<[string, string]> = [
      ["critical", "timeSensitive"],
      ["high", "active"],
      ["medium", "active"],
      ["low", "passive"],
    ];

    for (const [inputPriority, expectedPriority] of mapping) {
      invoke.mockClear();
      await dispatchNotification(
        deps,
        makeNotification({ priority: inputPriority as any }),
        [],
        defaultPreferences(),
      );
      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke.mock.calls[0]![0].params.priority).toBe(expectedPriority);
    }
  });

  it("handles node invoke failure gracefully", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "TIMEOUT", message: "timeout" },
    });
    const nodeInvoker: NodeInvoker = {
      listConnectedNodes: () => [
        { nodeId: "iphone-1", commands: ["system.notify"], platform: "ios" },
      ],
      invoke,
    };

    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: {},
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      nodeInvoker,
    };

    const results = await dispatchNotification(deps, makeNotification(), [], defaultPreferences());

    expect(results).toHaveLength(1);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toBe("timeout");
  });

  it("suppresses node push during quiet hours for non-critical", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true });
    const nodeInvoker: NodeInvoker = {
      listConnectedNodes: () => [
        { nodeId: "iphone-1", commands: ["system.notify"], platform: "ios" },
      ],
      invoke,
    };

    const deps: DispatchDeps = {
      cfg: {} as any,
      channelTargets: {},
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      nodeInvoker,
    };

    const quietPrefs: NotificationPreferences = {
      ...defaultPreferences(),
      quietHours: { enabled: true, startHour: 0, endHour: 23 },
    };

    // Non-critical: suppressed
    const results = await dispatchNotification(
      deps,
      makeNotification({ priority: "medium" }),
      [],
      quietPrefs,
    );
    expect(results).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();

    // Critical: still pushes
    const critResults = await dispatchNotification(
      deps,
      makeNotification({ priority: "critical" }),
      [],
      quietPrefs,
    );
    expect(critResults).toHaveLength(1);
    expect(critResults[0]!.success).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
  });
});

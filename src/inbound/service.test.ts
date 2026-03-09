import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  InboundMessage,
  InboundChannel,
  InboundRoute,
  RawInboundMessage,
  InboundSourceType,
} from "./types.js";
import { InboundService } from "./service.js";
import { readInboundStore, writeInboundStore } from "./store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let storePath: string;
let fakeNow: number;
let broadcasts: Array<{ event: string; payload: unknown }>;
let service: InboundService;

function makeService(sp: string) {
  broadcasts = [];
  fakeNow = 1_000_000;
  const svc = new InboundService({
    storePath: sp,
    log: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    broadcast: (event, payload) => {
      broadcasts.push({ event, payload });
    },
    nowMs: () => fakeNow,
  });
  return svc;
}

function rawMsg(overrides: Partial<RawInboundMessage> = {}): RawInboundMessage {
  return {
    source: {
      type: "discord",
      channelId: "ch-1",
      senderId: "user-1",
    },
    body: "Hello world",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-inbound-svc-"));
  storePath = path.join(tmpDir, "store.json");
  service = makeService(storePath);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Message Ingestion
// ---------------------------------------------------------------------------

describe("ingestMessage", () => {
  it("creates a message with ID, persists, and broadcasts", async () => {
    const msg = await service.ingestMessage(rawMsg());

    expect(msg.id).toBeTruthy();
    expect(msg.body).toBe("Hello world");
    expect(msg.status).toBe("pending");
    expect(msg.priority).toBe("medium");
    expect(msg.createdAtMs).toBe(1_000_000);

    const store = await readInboundStore(storePath);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.id).toBe(msg.id);

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]!.event).toBe("inbound.message.created");
  });

  it("deduplicates by externalId", async () => {
    const msg1 = await service.ingestMessage(rawMsg({ externalId: "ext-1" }));
    const msg2 = await service.ingestMessage(rawMsg({ externalId: "ext-1", body: "Different" }));

    expect(msg1.id).toBe(msg2.id);
    expect(msg2.body).toBe("Hello world"); // original body

    const store = await readInboundStore(storePath);
    expect(store.messages).toHaveLength(1);
  });

  it("uses channel defaultPriority when raw has none", async () => {
    // Add channel with defaultPriority=high
    await service.addChannel({
      type: "discord",
      name: "General",
      defaultPriority: "high",
    });
    const channels = await service.listChannels();
    const channelId = channels[0]!.id;

    const msg = await service.ingestMessage(rawMsg({ source: { type: "discord", channelId } }));

    expect(msg.priority).toBe("high");
  });

  it("route matching with autoExecute=true sets status to processing", async () => {
    await service.addRoute({
      name: "Auto Route",
      filter: { sourceTypes: ["discord"] },
      action: { forwardToAgent: "agent-1" },
      autoExecute: true,
    });

    const msg = await service.ingestMessage(rawMsg());

    expect(msg.status).toBe("processing");
    expect(msg.pendingAction).toBeUndefined();
  });

  it("route matching with autoExecute=false sets pendingAction", async () => {
    await service.addRoute({
      name: "Manual Route",
      filter: { sourceTypes: ["discord"] },
      action: { forwardToAgent: "agent-1" },
      autoExecute: false,
    });

    const msg = await service.ingestMessage(rawMsg());

    expect(msg.status).toBe("pending");
    expect(msg.pendingAction).toBeDefined();
    expect(msg.pendingAction!.routeName).toBe("Manual Route");
    expect(msg.pendingAction!.action.forwardToAgent).toBe("agent-1");
  });

  it("no route match leaves status as pending", async () => {
    // Route for telegram only, message is discord
    await service.addRoute({
      name: "Telegram Only",
      filter: { sourceTypes: ["telegram"] },
      action: { ignore: true },
      autoExecute: true,
    });

    const msg = await service.ingestMessage(rawMsg());

    expect(msg.status).toBe("pending");
    expect(msg.pendingAction).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listMessages
// ---------------------------------------------------------------------------

describe("listMessages", () => {
  it("returns all messages", async () => {
    await service.ingestMessage(rawMsg({ body: "One" }));
    await service.ingestMessage(rawMsg({ body: "Two" }));

    const all = await service.listMessages();
    expect(all).toHaveLength(2);
  });

  it("filters by status", async () => {
    const msg = await service.ingestMessage(rawMsg());
    await service.markProcessed(msg.id);

    await service.ingestMessage(rawMsg({ body: "Still pending" }));

    const processed = await service.listMessages({ status: "processed" });
    expect(processed).toHaveLength(1);
    expect(processed[0]!.status).toBe("processed");
  });

  it("filters by sourceType", async () => {
    await service.ingestMessage(rawMsg());
    await service.ingestMessage(rawMsg({ source: { type: "telegram", channelId: "tg-1" } }));

    const discord = await service.listMessages({ sourceType: "discord" });
    expect(discord).toHaveLength(1);
    expect(discord[0]!.source.type).toBe("discord");
  });

  it("filters by priority", async () => {
    await service.ingestMessage(rawMsg({ priority: "critical" }));
    await service.ingestMessage(rawMsg({ priority: "low" }));

    const critical = await service.listMessages({ priority: "critical" });
    expect(critical).toHaveLength(1);
    expect(critical[0]!.priority).toBe("critical");
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await service.ingestMessage(rawMsg({ body: `msg-${i}` }));
    }

    const limited = await service.listMessages({ limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getMessage
// ---------------------------------------------------------------------------

describe("getMessage", () => {
  it("returns message by ID", async () => {
    const msg = await service.ingestMessage(rawMsg());
    const found = await service.getMessage(msg.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(msg.id);
  });

  it("returns null for unknown ID", async () => {
    const found = await service.getMessage("nonexistent");
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// markProcessed
// ---------------------------------------------------------------------------

describe("markProcessed", () => {
  it("updates status, sets processedAtMs, clears pendingAction", async () => {
    // Set up a route so pendingAction is set
    await service.addRoute({
      name: "Route",
      filter: {},
      action: { forwardToAgent: "a1" },
      autoExecute: false,
    });

    const msg = await service.ingestMessage(rawMsg());
    expect(msg.pendingAction).toBeDefined();

    fakeNow = 2_000_000;
    const processed = await service.markProcessed(msg.id, { summary: "Done" });

    expect(processed).not.toBeNull();
    expect(processed!.status).toBe("processed");
    expect(processed!.processedAtMs).toBe(2_000_000);
    expect(processed!.pendingAction).toBeUndefined();
    expect(processed!.result!.summary).toBe("Done");

    const updated = broadcasts.find((b) => b.event === "inbound.message.updated");
    expect(updated).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// deleteMessage
// ---------------------------------------------------------------------------

describe("deleteMessage", () => {
  it("removes and broadcasts", async () => {
    const msg = await service.ingestMessage(rawMsg());
    const result = await service.deleteMessage(msg.id);

    expect(result).toBe(true);

    const store = await readInboundStore(storePath);
    expect(store.messages).toHaveLength(0);

    const deleted = broadcasts.find((b) => b.event === "inbound.message.deleted");
    expect(deleted).toBeDefined();
  });

  it("returns false for unknown", async () => {
    const result = await service.deleteMessage("nonexistent");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// linkToTask
// ---------------------------------------------------------------------------

describe("linkToTask", () => {
  it("sets taskId", async () => {
    const msg = await service.ingestMessage(rawMsg());
    const linked = await service.linkToTask(msg.id, "task-42");

    expect(linked).not.toBeNull();
    expect(linked!.taskId).toBe("task-42");

    const updated = broadcasts.find((b) => b.event === "inbound.message.updated");
    expect(updated).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getUnprocessedCount
// ---------------------------------------------------------------------------

describe("getUnprocessedCount", () => {
  it("counts non-processed/non-ignored", async () => {
    const m1 = await service.ingestMessage(rawMsg({ body: "a" }));
    await service.ingestMessage(rawMsg({ body: "b" }));
    await service.markProcessed(m1.id);

    const count = await service.getUnprocessedCount();
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

describe("channels", () => {
  it("addChannel — creates with ID, persists, broadcasts", async () => {
    const ch = await service.addChannel({
      type: "slack",
      name: "General",
    });

    expect(ch.id).toBeTruthy();
    expect(ch.type).toBe("slack");
    expect(ch.name).toBe("General");
    expect(ch.enabled).toBe(true);
    expect(ch.messageCount).toBe(0);

    const store = await readInboundStore(storePath);
    expect(store.channels).toHaveLength(1);

    const added = broadcasts.find((b) => b.event === "inbound.channel.added");
    expect(added).toBeDefined();
  });

  it("updateChannel — patches fields", async () => {
    const ch = await service.addChannel({ type: "slack", name: "General" });
    fakeNow = 2_000_000;
    const updated = await service.updateChannel(ch.id, {
      name: "Renamed",
      enabled: false,
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Renamed");
    expect(updated!.enabled).toBe(false);
    expect(updated!.updatedAtMs).toBe(2_000_000);
  });

  it("removeChannel — removes and broadcasts", async () => {
    const ch = await service.addChannel({ type: "slack", name: "General" });
    const result = await service.removeChannel(ch.id);

    expect(result).toBe(true);

    const store = await readInboundStore(storePath);
    expect(store.channels).toHaveLength(0);

    const removed = broadcasts.find((b) => b.event === "inbound.channel.removed");
    expect(removed).toBeDefined();
  });

  it("listChannels — returns all", async () => {
    await service.addChannel({ type: "slack", name: "A" });
    await service.addChannel({ type: "discord", name: "B" });

    const list = await service.listChannels();
    expect(list).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe("routes", () => {
  it("addRoute — creates with auto-order", async () => {
    const r1 = await service.addRoute({
      name: "First",
      filter: {},
      action: { ignore: true },
    });
    const r2 = await service.addRoute({
      name: "Second",
      filter: {},
      action: { ignore: true },
    });

    expect(r1.order).toBe(0);
    expect(r2.order).toBe(1);
    expect(r1.enabled).toBe(true);
    expect(r1.autoExecute).toBe(false);

    const added = broadcasts.filter((b) => b.event === "inbound.route.added");
    expect(added).toHaveLength(2);
  });

  it("updateRoute — patches fields", async () => {
    const r = await service.addRoute({
      name: "Original",
      filter: {},
      action: { ignore: true },
    });
    fakeNow = 2_000_000;
    const updated = await service.updateRoute(r.id, {
      name: "Updated",
      autoExecute: true,
      order: 99,
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated");
    expect(updated!.autoExecute).toBe(true);
    expect(updated!.order).toBe(99);
    expect(updated!.updatedAtMs).toBe(2_000_000);
  });

  it("removeRoute — removes and broadcasts", async () => {
    const r = await service.addRoute({
      name: "Doomed",
      filter: {},
      action: { ignore: true },
    });
    const result = await service.removeRoute(r.id);

    expect(result).toBe(true);

    const store = await readInboundStore(storePath);
    expect(store.routes).toHaveLength(0);

    const removed = broadcasts.find((b) => b.event === "inbound.route.removed");
    expect(removed).toBeDefined();
  });

  it("listRoutes — sorted by order", async () => {
    await service.addRoute({
      name: "Third",
      filter: {},
      action: { ignore: true },
      order: 10,
    });
    await service.addRoute({
      name: "First",
      filter: {},
      action: { ignore: true },
      order: 1,
    });
    await service.addRoute({
      name: "Second",
      filter: {},
      action: { ignore: true },
      order: 5,
    });

    const list = await service.listRoutes();
    expect(list.map((r) => r.name)).toEqual(["First", "Second", "Third"]);
  });
});

// ---------------------------------------------------------------------------
// Route Matching
// ---------------------------------------------------------------------------

describe("route matching", () => {
  it("minPriority filter — critical > high > medium > low", async () => {
    await service.addRoute({
      name: "High+ Only",
      filter: { minPriority: "high" },
      action: { forwardToAgent: "agent-1" },
      autoExecute: true,
    });

    // Critical matches (rank 0 <= rank 1)
    const critical = await service.ingestMessage(rawMsg({ priority: "critical" }));
    expect(critical.status).toBe("processing");

    // High matches (rank 1 <= rank 1)
    const high = await service.ingestMessage(rawMsg({ priority: "high" }));
    expect(high.status).toBe("processing");

    // Medium does NOT match (rank 2 > rank 1)
    const medium = await service.ingestMessage(rawMsg({ priority: "medium" }));
    expect(medium.status).toBe("pending");

    // Low does NOT match (rank 3 > rank 1)
    const low = await service.ingestMessage(rawMsg({ priority: "low" }));
    expect(low.status).toBe("pending");
  });

  it("keyword filter — case-insensitive body+subject search", async () => {
    await service.addRoute({
      name: "Urgent Keyword",
      filter: { keywords: ["URGENT"] },
      action: { forwardToAgent: "agent-1" },
      autoExecute: true,
    });

    // Match in body (case-insensitive)
    const m1 = await service.ingestMessage(rawMsg({ body: "this is urgent please" }));
    expect(m1.status).toBe("processing");

    // Match in subject
    const m2 = await service.ingestMessage(
      rawMsg({ body: "normal body", subject: "Urgent Request" }),
    );
    expect(m2.status).toBe("processing");

    // No match
    const m3 = await service.ingestMessage(rawMsg({ body: "nothing special" }));
    expect(m3.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Prune
// ---------------------------------------------------------------------------

describe("prune", () => {
  it("removes old messages (30 day TTL)", async () => {
    // Create a message at time 0
    fakeNow = 0;
    await service.ingestMessage(rawMsg({ body: "old" }));

    // Create a message at time now
    const thirtyOneDays = 31 * 24 * 60 * 60 * 1000;
    fakeNow = thirtyOneDays;
    await service.ingestMessage(rawMsg({ body: "new" }));

    const removed = await service.prune();
    expect(removed).toBe(1);

    const store = await readInboundStore(storePath);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.body).toBe("new");
  });

  it("enforces 10,000 cap", async () => {
    // Seed store directly with 10,002 messages
    const store = await readInboundStore(storePath);
    for (let i = 0; i < 10_002; i++) {
      store.messages.push({
        id: `msg-${i}`,
        source: { type: "discord", channelId: "ch-1" },
        status: "pending",
        priority: "medium",
        body: `msg ${i}`,
        createdAtMs: i, // oldest first
        updatedAtMs: i,
      });
    }
    await writeInboundStore(storePath, store);

    fakeNow = 10_002; // All messages are < 30 days old relative to this
    const removed = await service.prune();
    expect(removed).toBe(2);

    const after = await readInboundStore(storePath);
    expect(after.messages).toHaveLength(10_000);
    // Should keep newest
    expect(after.messages[0]!.id).toBe("msg-10001");
  });
});

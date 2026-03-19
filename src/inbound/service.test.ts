import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawInboundMessage } from "./types.js";
import { InboundService, type InboundServiceDeps } from "./service.js";
import { readInboundStore, writeInboundStore } from "./store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let storePath: string;
let fakeNow: number;
let broadcasts: Array<{ event: string; payload: unknown }>;
let service: InboundService;

function makeService(sp: string, extraDeps: Partial<InboundServiceDeps> = {}) {
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
    ...extraDeps,
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
    expect(msg.status).toBe("unread");
    expect(msg.direction).toBe("inbound");
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

  it("route matching with autoExecute=true sets status to read", async () => {
    await service.addRoute({
      name: "Auto Route",
      filter: { sourceTypes: ["discord"] },
      action: { forwardToAgent: "agent-1" },
      autoExecute: true,
    });

    const msg = await service.ingestMessage(rawMsg());

    expect(msg.status).toBe("read");
  });

  it("route matching with autoExecute=false leaves status as unread", async () => {
    await service.addRoute({
      name: "Manual Route",
      filter: { sourceTypes: ["discord"] },
      action: { forwardToAgent: "agent-1" },
      autoExecute: false,
    });

    const msg = await service.ingestMessage(rawMsg());

    // Non-auto routes leave status as unread (createPendingTask fires in background)
    expect(msg.status).toBe("unread");
  });

  it("no route match leaves status as unread", async () => {
    // Route for telegram only, message is discord
    await service.addRoute({
      name: "Telegram Only",
      filter: { sourceTypes: ["telegram"] },
      action: { ignore: true },
      autoExecute: true,
    });

    const msg = await service.ingestMessage(rawMsg());

    expect(msg.status).toBe("unread");
  });

  it("calls resolvePerson when dep is provided", async () => {
    const resolvePerson = vi.fn().mockResolvedValue({ personId: "person-42" });
    service = makeService(storePath, { resolvePerson });

    await service.ingestMessage(rawMsg());

    // resolvePerson fires in a queueMicrotask, flush it
    await new Promise((r) => setTimeout(r, 50));

    expect(resolvePerson).toHaveBeenCalledWith("user-1", "discord", undefined);

    // personId should be set on the stored message
    const store = await readInboundStore(storePath);
    expect(store.messages[0]!.personId).toBe("person-42");
  });
});

// ---------------------------------------------------------------------------
// listMessages
// ---------------------------------------------------------------------------

describe("listMessages", () => {
  it("returns paginated messages", async () => {
    await service.ingestMessage(rawMsg({ body: "One" }));
    await service.ingestMessage(rawMsg({ body: "Two" }));

    const page = await service.listMessages();
    expect(page.messages).toHaveLength(2);
    expect(page.totalCount).toBe(2);
  });

  it("filters by status", async () => {
    const msg = await service.ingestMessage(rawMsg());
    await service.setStatus(msg.id, "archived");

    await service.ingestMessage(rawMsg({ body: "Still unread" }));

    const archived = await service.listMessages({ status: ["archived"] });
    expect(archived.messages).toHaveLength(1);
    expect(archived.messages[0]!.status).toBe("archived");
  });

  it("filters by sourceType", async () => {
    await service.ingestMessage(rawMsg());
    await service.ingestMessage(rawMsg({ source: { type: "telegram", channelId: "tg-1" } }));

    const discord = await service.listMessages({ sourceTypes: ["discord"] });
    expect(discord.messages).toHaveLength(1);
    expect(discord.messages[0]!.source.type).toBe("discord");
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await service.ingestMessage(rawMsg({ body: `msg-${i}` }));
    }

    const limited = await service.listMessages(undefined, undefined, 2);
    expect(limited.messages).toHaveLength(2);
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
// setStatus
// ---------------------------------------------------------------------------

describe("setStatus", () => {
  it("updates status and broadcasts", async () => {
    const msg = await service.ingestMessage(rawMsg());
    fakeNow = 2_000_000;
    const updated = await service.setStatus(msg.id, "archived");

    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("archived");
    expect(updated!.archivedAtMs).toBe(2_000_000);

    const evt = broadcasts.find((b) => b.event === "inbound.message.updated");
    expect(evt).toBeDefined();
  });

  it("sets readAtMs on read", async () => {
    const msg = await service.ingestMessage(rawMsg());
    fakeNow = 2_000_000;
    const updated = await service.setStatus(msg.id, "read");
    expect(updated!.readAtMs).toBe(2_000_000);
  });

  it("sets snoozedUntilMs on snooze", async () => {
    const msg = await service.ingestMessage(rawMsg());
    const updated = await service.setStatus(msg.id, "snoozed", 9_000_000);
    expect(updated!.status).toBe("snoozed");
    expect(updated!.snoozedUntilMs).toBe(9_000_000);
  });

  it("clears snoozedUntilMs on unread", async () => {
    const msg = await service.ingestMessage(rawMsg());
    await service.setStatus(msg.id, "snoozed", 9_000_000);
    const updated = await service.setStatus(msg.id, "unread");
    expect(updated!.snoozedUntilMs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// markProcessed (deprecated — delegates to setStatus("archived"))
// ---------------------------------------------------------------------------

describe("markProcessed", () => {
  it("archives the message (deprecated)", async () => {
    const msg = await service.ingestMessage(rawMsg());
    fakeNow = 2_000_000;
    const processed = await service.markProcessed(msg.id);

    expect(processed).not.toBeNull();
    expect(processed!.status).toBe("archived");
    expect(processed!.archivedAtMs).toBe(2_000_000);
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
  it("counts non-archived", async () => {
    const m1 = await service.ingestMessage(rawMsg({ body: "a" }));
    await service.ingestMessage(rawMsg({ body: "b" }));
    await service.setStatus(m1.id, "archived");

    const count = await service.getUnprocessedCount();
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// replyToMessage
// ---------------------------------------------------------------------------

describe("replyToMessage", () => {
  it("creates an outbound reply message in the same thread", async () => {
    const original = await service.ingestMessage(rawMsg());
    broadcasts = []; // reset

    fakeNow = 2_000_000;
    const reply = await service.replyToMessage(original.id, "Thanks for your message!");

    expect(reply).not.toBeNull();
    expect(reply!.direction).toBe("outbound");
    expect(reply!.status).toBe("read");
    expect(reply!.body).toBe("Thanks for your message!");
    expect(reply!.replyToId).toBe(original.id);
    expect(reply!.threadId).toBe(`thread:${original.id}`);
    expect(reply!.source.type).toBe("discord");
    expect(reply!.source.channelId).toBe("ch-1");
    expect(reply!.createdAtMs).toBe(2_000_000);

    // Verify stored
    const store = await readInboundStore(storePath);
    expect(store.messages).toHaveLength(2);
    const storedReply = store.messages.find((m) => m.id === reply!.id);
    expect(storedReply).toBeDefined();
    expect(storedReply!.direction).toBe("outbound");

    // Original should have threadId set now too
    const storedOriginal = store.messages.find((m) => m.id === original.id);
    expect(storedOriginal!.threadId).toBe(`thread:${original.id}`);

    // Event
    const evt = broadcasts.find((b) => b.event === "inbound.message.replied");
    expect(evt).toBeDefined();
  });

  it("uses existing threadId if original already has one", async () => {
    // Ingest, then manually set threadId via store
    const original = await service.ingestMessage(rawMsg());
    const store = await readInboundStore(storePath);
    store.messages[0]!.threadId = "existing-thread-123";
    await writeInboundStore(storePath, store);

    const reply = await service.replyToMessage(original.id, "Reply");

    expect(reply!.threadId).toBe("existing-thread-123");
  });

  it("returns null for nonexistent message", async () => {
    const reply = await service.replyToMessage("nonexistent", "Hello");
    expect(reply).toBeNull();
  });

  it("calls deliverReply dep if available", async () => {
    const deliverReply = vi.fn().mockResolvedValue(undefined);
    service = makeService(storePath, { deliverReply });

    const original = await service.ingestMessage(rawMsg());
    await service.replyToMessage(original.id, "Reply body");

    // deliverReply fires in queueMicrotask
    await new Promise((r) => setTimeout(r, 50));

    expect(deliverReply).toHaveBeenCalledTimes(1);
    expect(deliverReply).toHaveBeenCalledWith(
      "discord",
      expect.any(Object), // channelConfig
      "Reply body",
      expect.objectContaining({
        channelId: "ch-1",
        senderId: "user-1",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Snooze expiry
// ---------------------------------------------------------------------------

describe("snooze expiry", () => {
  it("unsnoozes time-based snoozeConfig when expired", async () => {
    await service.ingestMessage(rawMsg());

    // Manually set snooze with snoozeConfig
    const store = await readInboundStore(storePath);
    store.messages[0]!.status = "snoozed";
    store.messages[0]!.snoozeConfig = {
      type: "time",
      untilMs: 5_000_000,
      snoozedAtMs: 1_000_000,
    };
    await writeInboundStore(storePath, store);

    // Before expiry: should stay snoozed
    fakeNow = 4_000_000;
    const page1 = await service.listMessages();
    expect(page1.messages[0]!.status).toBe("snoozed");

    // After expiry: should be unsnoozed
    fakeNow = 5_000_001;
    const page2 = await service.listMessages();
    expect(page2.messages[0]!.status).toBe("unread");
    expect(page2.messages[0]!.snoozeConfig).toBeUndefined();
    expect(page2.messages[0]!.snoozedUntilMs).toBeUndefined();
  });

  it("unsnoozes reply-based snoozeConfig when reply arrives", async () => {
    // Create original message from person-A
    const msg = await service.ingestMessage(rawMsg());

    // Set it as snoozed until reply from person-B
    const store = await readInboundStore(storePath);
    store.messages[0]!.status = "snoozed";
    store.messages[0]!.snoozeConfig = {
      type: "reply",
      untilReplyFromPersonId: "person-B",
      snoozedAtMs: 1_000_000,
    };
    await writeInboundStore(storePath, store);

    // No reply yet — should stay snoozed
    fakeNow = 2_000_000;
    const page1 = await service.listMessages();
    expect(page1.messages[0]!.status).toBe("snoozed");

    // Now simulate a new inbound message from person-B
    const store2 = await readInboundStore(storePath);
    store2.messages.push({
      id: "reply-from-B",
      source: { type: "discord", channelId: "ch-1", senderId: "person-B" },
      status: "unread",
      direction: "inbound",
      body: "Reply from B",
      bodyResolved: "Reply from B",
      mentions: [],
      personId: "person-B",
      createdAtMs: 2_000_000,
      updatedAtMs: 2_000_000,
    });
    await writeInboundStore(storePath, store2);

    // Now check — should be unsnoozed
    fakeNow = 3_000_000;
    const page2 = await service.listMessages();
    const snoozedMsg = page2.messages.find((m) => m.id === msg.id);
    expect(snoozedMsg!.status).toBe("unread");
  });

  it("legacy snoozedUntilMs (no snoozeConfig) still works", async () => {
    await service.ingestMessage(rawMsg());

    const store = await readInboundStore(storePath);
    store.messages[0]!.status = "snoozed";
    store.messages[0]!.snoozedUntilMs = 3_000_000;
    await writeInboundStore(storePath, store);

    fakeNow = 3_000_001;
    const page = await service.listMessages();
    expect(page.messages[0]!.status).toBe("unread");
    expect(page.messages[0]!.snoozedUntilMs).toBeUndefined();
  });

  it("task-based snooze is skipped (not yet wired)", async () => {
    await service.ingestMessage(rawMsg());

    const store = await readInboundStore(storePath);
    store.messages[0]!.status = "snoozed";
    store.messages[0]!.snoozeConfig = {
      type: "task",
      untilTaskId: "task-123",
      snoozedAtMs: 1_000_000,
    };
    await writeInboundStore(storePath, store);

    fakeNow = 99_000_000;
    const page = await service.listMessages();
    expect(page.messages[0]!.status).toBe("snoozed"); // still snoozed
  });

  it("pipeline-based snooze is skipped (not yet wired)", async () => {
    await service.ingestMessage(rawMsg());

    const store = await readInboundStore(storePath);
    store.messages[0]!.status = "snoozed";
    store.messages[0]!.snoozeConfig = {
      type: "pipeline",
      untilPipelineRunId: "run-456",
      snoozedAtMs: 1_000_000,
    };
    await writeInboundStore(storePath, store);

    fakeNow = 99_000_000;
    const page = await service.listMessages();
    expect(page.messages[0]!.status).toBe("snoozed"); // still snoozed
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
  it("minPriority filter is a no-op (matches all)", async () => {
    // minPriority filter was deprecated in v2 — routes with it simply match all messages
    await service.addRoute({
      name: "High+ Only",
      filter: { minPriority: "high" },
      action: { forwardToAgent: "agent-1" },
      autoExecute: true,
    });

    // All messages match since minPriority is now a no-op
    const msg = await service.ingestMessage(rawMsg());
    expect(msg.status).toBe("read"); // autoExecute sets to read
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
    expect(m1.status).toBe("read");

    // Match in subject
    const m2 = await service.ingestMessage(
      rawMsg({ body: "normal body", subject: "Urgent Request" }),
    );
    expect(m2.status).toBe("read");

    // No match
    const m3 = await service.ingestMessage(rawMsg({ body: "nothing special" }));
    expect(m3.status).toBe("unread");
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
        status: "unread",
        direction: "inbound",
        body: `msg ${i}`,
        bodyResolved: `msg ${i}`,
        mentions: [],
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

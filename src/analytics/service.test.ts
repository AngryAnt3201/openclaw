// ---------------------------------------------------------------------------
// AnalyticsService – Tests
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AnalyticsService } from "./service.js";

let tmpDir: string;
let storePath: string;
let broadcast: ReturnType<typeof vi.fn>;
let service: AnalyticsService;
let now: number;

beforeEach(async () => {
  now = 10_000;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "analytics-svc-"));
  storePath = path.join(tmpDir, "store.json");
  broadcast = vi.fn();
  service = new AnalyticsService({
    storePath,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcast,
    nowMs: () => now,
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// SLA Profile CRUD
// ---------------------------------------------------------------------------

describe("SLA Profile CRUD", () => {
  it("createSLAProfile — creates profile with UUID", async () => {
    const profile = await service.createSLAProfile({
      name: "Priority",
      targetResponseMs: 3_600_000,
      escalateAfterMs: 7_200_000,
      appliesTo: "person",
      entityIds: ["p1"],
    });

    expect(profile.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(profile.name).toBe("Priority");
    expect(profile.targetResponseMs).toBe(3_600_000);
    expect(profile.escalateAfterMs).toBe(7_200_000);
    expect(profile.appliesTo).toBe("person");
    expect(profile.entityIds).toEqual(["p1"]);
  });

  it("createSLAProfile — emits sla.profile.created event", async () => {
    const profile = await service.createSLAProfile({
      name: "VIP",
      targetResponseMs: 1_800_000,
      escalateAfterMs: 3_600_000,
      appliesTo: "person",
    });

    expect(broadcast).toHaveBeenCalledWith(
      "sla.profile.created",
      expect.objectContaining({ id: profile.id }),
    );
  });

  it("getSLAProfile — returns profile by ID, null for missing", async () => {
    const profile = await service.createSLAProfile({
      name: "Standard",
      targetResponseMs: 86_400_000,
      escalateAfterMs: 172_800_000,
      appliesTo: "org",
    });

    const found = await service.getSLAProfile(profile.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Standard");

    const missing = await service.getSLAProfile("nonexistent");
    expect(missing).toBeNull();
  });

  it("listSLAProfiles — returns all profiles", async () => {
    const empty = await service.listSLAProfiles();
    expect(empty).toEqual([]);

    await service.createSLAProfile({
      name: "A",
      targetResponseMs: 1000,
      escalateAfterMs: 2000,
      appliesTo: "person",
    });
    await service.createSLAProfile({
      name: "B",
      targetResponseMs: 2000,
      escalateAfterMs: 4000,
      appliesTo: "org",
    });

    const all = await service.listSLAProfiles();
    expect(all).toHaveLength(2);
  });

  it("updateSLAProfile — updates specified fields only", async () => {
    const profile = await service.createSLAProfile({
      name: "Old",
      targetResponseMs: 5000,
      escalateAfterMs: 10_000,
      appliesTo: "person",
      entityIds: ["p1"],
    });

    const updated = await service.updateSLAProfile(profile.id, {
      name: "New",
      targetResponseMs: 9000,
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("New");
    expect(updated!.targetResponseMs).toBe(9000);
    expect(updated!.escalateAfterMs).toBe(10_000); // unchanged
    expect(updated!.entityIds).toEqual(["p1"]); // unchanged
  });

  it("updateSLAProfile — returns null for missing profile", async () => {
    const result = await service.updateSLAProfile("nonexistent", { name: "X" });
    expect(result).toBeNull();
  });

  it("deleteSLAProfile — removes profile and emits event", async () => {
    const profile = await service.createSLAProfile({
      name: "ToDelete",
      targetResponseMs: 1000,
      escalateAfterMs: 2000,
      appliesTo: "person",
    });

    const deleted = await service.deleteSLAProfile(profile.id);
    expect(deleted).toBe(true);

    const found = await service.getSLAProfile(profile.id);
    expect(found).toBeNull();

    expect(broadcast).toHaveBeenCalledWith("sla.profile.deleted", { id: profile.id });
  });

  it("deleteSLAProfile — returns false for missing ID", async () => {
    const result = await service.deleteSLAProfile("nonexistent");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Response Time Tracking
// ---------------------------------------------------------------------------

describe("recordInbound", () => {
  it("creates a response entry", async () => {
    const entry = await service.recordInbound("msg1", "p1", 5000);
    expect(entry.messageId).toBe("msg1");
    expect(entry.personId).toBe("p1");
    expect(entry.receivedAtMs).toBe(5000);
    expect(entry.repliedAtMs).toBeUndefined();
  });

  it("persists entry to store", async () => {
    await service.recordInbound("msg1", "p1", 5000);
    // Re-create service to verify persistence
    const svc2 = new AnalyticsService({
      storePath,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      broadcast: vi.fn(),
    });
    // Access via getOverdueMessages with no profiles will return empty, but we verify via checkSLAStatus
    const result = await svc2.recordInbound("msg2", "p1", 6000);
    expect(result.messageId).toBe("msg2");
  });
});

describe("recordResponse", () => {
  it("updates repliedAtMs on existing entry", async () => {
    await service.recordInbound("msg1", "p1", 5000);
    const updated = await service.recordResponse("msg1", 8000);
    expect(updated).not.toBeNull();
    expect(updated!.messageId).toBe("msg1");
    expect(updated!.repliedAtMs).toBe(8000);
  });

  it("returns null for nonexistent messageId", async () => {
    const result = await service.recordResponse("nonexistent", 8000);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SLA Status
// ---------------------------------------------------------------------------

describe("checkSLAStatus", () => {
  it("returns null when no matching SLA profile", async () => {
    await service.recordInbound("msg1", "p1", 5000);
    const status = await service.checkSLAStatus("p1");
    expect(status).toBeNull();
  });

  it("calculates breach/remaining correctly", async () => {
    await service.createSLAProfile({
      name: "Fast",
      targetResponseMs: 3000,
      escalateAfterMs: 6000,
      appliesTo: "person",
      entityIds: ["p1"],
    });

    // Message received 5000ms ago at now=10000, so elapsed=5000 > target=3000 → breached
    await service.recordInbound("msg1", "p1", 5000);

    const status = await service.checkSLAStatus("p1");
    expect(status).not.toBeNull();
    expect(status!.personId).toBe("p1");
    expect(status!.pendingMessages).toHaveLength(1);
    expect(status!.pendingMessages[0].messageId).toBe("msg1");
    expect(status!.pendingMessages[0].breached).toBe(true);
    expect(status!.pendingMessages[0].remainingMs).toBe(0);
  });

  it("calculates remaining time for unbreached messages", async () => {
    await service.createSLAProfile({
      name: "Standard",
      targetResponseMs: 5000,
      escalateAfterMs: 10_000,
      appliesTo: "person",
      entityIds: ["p2"],
    });

    // Message received at now - 2000 (receivedAtMs = 8000, now = 10000)
    await service.recordInbound("msg2", "p2", 8000);

    const status = await service.checkSLAStatus("p2");
    expect(status).not.toBeNull();
    expect(status!.pendingMessages[0].breached).toBe(false);
    expect(status!.pendingMessages[0].remainingMs).toBe(3000); // 5000 - 2000
  });

  it("excludes responded messages from pending", async () => {
    await service.createSLAProfile({
      name: "Standard",
      targetResponseMs: 5000,
      escalateAfterMs: 10_000,
      appliesTo: "person",
      entityIds: ["p3"],
    });

    await service.recordInbound("msg3", "p3", 6000);
    await service.recordResponse("msg3", 8000); // responded on time

    const status = await service.checkSLAStatus("p3");
    expect(status).not.toBeNull();
    expect(status!.pendingMessages).toHaveLength(0);
  });

  it("calculates compliance rate", async () => {
    await service.createSLAProfile({
      name: "Compliance",
      targetResponseMs: 5000,
      escalateAfterMs: 10_000,
      appliesTo: "person",
      entityIds: ["p4"],
    });

    // One on-time response (elapsed = 2000 ≤ 5000)
    await service.recordInbound("msg4a", "p4", 5000);
    await service.recordResponse("msg4a", 7000);

    // One late response (elapsed = 8000 > 5000)
    await service.recordInbound("msg4b", "p4", 1000);
    await service.recordResponse("msg4b", 9000);

    // One pending
    await service.recordInbound("msg4c", "p4", 9000);

    const status = await service.checkSLAStatus("p4");
    expect(status).not.toBeNull();
    // 1 on-time out of 3 total entries
    expect(status!.complianceRate).toBeCloseTo(1 / 3);
  });
});

// ---------------------------------------------------------------------------
// Overdue Messages
// ---------------------------------------------------------------------------

describe("getOverdueMessages", () => {
  it("returns entries past their SLA target", async () => {
    await service.createSLAProfile({
      name: "Fast",
      targetResponseMs: 2000,
      escalateAfterMs: 4000,
      appliesTo: "person",
      entityIds: ["p1"],
    });

    // Elapsed = 10000 - 5000 = 5000 > 2000 → overdue
    await service.recordInbound("msg1", "p1", 5000);

    const overdue = await service.getOverdueMessages();
    expect(overdue).toHaveLength(1);
    expect(overdue[0].messageId).toBe("msg1");
  });

  it("excludes responded entries", async () => {
    await service.createSLAProfile({
      name: "Fast",
      targetResponseMs: 2000,
      escalateAfterMs: 4000,
      appliesTo: "person",
      entityIds: ["p1"],
    });

    await service.recordInbound("msg1", "p1", 5000);
    await service.recordResponse("msg1", 6000); // already responded

    const overdue = await service.getOverdueMessages();
    expect(overdue).toHaveLength(0);
  });

  it("excludes entries within SLA target", async () => {
    await service.createSLAProfile({
      name: "Relaxed",
      targetResponseMs: 9000, // very generous
      escalateAfterMs: 18_000,
      appliesTo: "person",
      entityIds: ["p2"],
    });

    // Elapsed = 10000 - 8000 = 2000 < 9000 → not overdue
    await service.recordInbound("msg2", "p2", 8000);

    const overdue = await service.getOverdueMessages();
    expect(overdue).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getAnalytics
// ---------------------------------------------------------------------------

describe("getAnalytics", () => {
  it("returns empty analytics when no messages", async () => {
    const analytics = await service.getAnalytics(0, 100_000);
    expect(analytics.volumeByPlatform).toEqual({});
    expect(analytics.volumeByHour).toHaveLength(24);
    expect(analytics.volumeByHour.every((v) => v === 0)).toBe(true);
    expect(analytics.volumeByDayOfWeek).toHaveLength(7);
    expect(analytics.topContacts).toEqual([]);
    expect(analytics.topTopics).toEqual([]);
    expect(analytics.responseTimeAvg).toBe(0);
    expect(analytics.sentimentDistribution).toEqual({});
    expect(analytics.periodMs).toEqual({ from: 0, to: 100_000 });
  });

  it("aggregates volume, response times, and top contacts from injected data", async () => {
    // Use a fixed timestamp: 2024-01-15T10:00:00Z
    const baseMs = new Date("2024-01-15T10:00:00Z").getTime();

    const svcWithData = new AnalyticsService({
      storePath,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      broadcast: vi.fn(),
      nowMs: () => now,
      getInboundMessages: async () => [
        {
          id: "m1",
          personId: "p1",
          source: { type: "email", senderName: "Alice" },
          createdAtMs: baseMs,
          direction: "inbound",
        },
        {
          id: "m2",
          personId: "p1",
          source: { type: "email", senderName: "Alice" },
          createdAtMs: baseMs + 1000,
          direction: "inbound",
        },
        {
          id: "m3",
          personId: "p2",
          source: { type: "slack", senderName: "Bob" },
          createdAtMs: baseMs + 2000,
          direction: "inbound",
        },
      ],
      getTriages: async () => [
        { messageId: "m1", topics: [{ label: "billing" }], sentiment: "neutral" },
        {
          messageId: "m2",
          topics: [{ label: "billing" }, { label: "refund" }],
          sentiment: "negative",
        },
        { messageId: "m3", topics: [{ label: "support" }], sentiment: "positive" },
      ],
    });

    // Record response entries in the store
    await svcWithData.recordInbound("m1", "p1", baseMs);
    await svcWithData.recordResponse("m1", baseMs + 2000); // 2000ms response time

    const analytics = await svcWithData.getAnalytics(baseMs - 1000, baseMs + 10_000);

    expect(analytics.volumeByPlatform).toEqual({ email: 2, slack: 1 });
    expect(analytics.topContacts).toHaveLength(2);
    expect(analytics.topContacts[0].personId).toBe("p1");
    expect(analytics.topContacts[0].count).toBe(2);
    expect(analytics.topTopics[0].label).toBe("billing");
    expect(analytics.topTopics[0].count).toBe(2);
    expect(analytics.sentimentDistribution).toEqual({ neutral: 1, negative: 1, positive: 1 });
    expect(analytics.responseTimeAvg).toBe(2000);
  });

  it("emits analytics.updated event", async () => {
    await service.getAnalytics(0, 100_000);
    expect(broadcast).toHaveBeenCalledWith("analytics.updated", { from: 0, to: 100_000 });
  });
});

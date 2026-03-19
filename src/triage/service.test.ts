// ---------------------------------------------------------------------------
// TriageService – Tests
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { TriageContext, AITriageResult } from "./service.js";
import { TriageService } from "./service.js";

let tmpDir: string;
let storePath: string;
let broadcast: ReturnType<typeof vi.fn>;
let service: TriageService;

// Use a recent timestamp so the 30-day prune in the store does not discard entries
const NOW_MS = Date.now();

const baseContext: TriageContext = {
  messageBody: "Hello, can you help with my invoice?",
  senderName: "Alice",
};

const mockAIResult: AITriageResult = {
  priorityScore: 80,
  priorityFactors: [{ reason: "billing query", weight: 0.8 }],
  topics: [{ label: "billing", confidence: 0.9, source: "ai" }],
  sentiment: "neutral",
  suggestedAction: "reply",
  autoDraft: "Hi Alice, I'd be happy to help with your invoice.",
};

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "triage-svc-"));
  storePath = path.join(tmpDir, "store.json");
  broadcast = vi.fn();
  service = new TriageService({
    storePath,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcast,
    nowMs: () => NOW_MS,
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// triageMessage
// ---------------------------------------------------------------------------

describe("triageMessage", () => {
  it("stores triage with all AI fields when dep is provided", async () => {
    const svc = new TriageService({
      storePath,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      broadcast,
      nowMs: () => NOW_MS,
      runAITriage: vi.fn().mockResolvedValue(mockAIResult),
    });

    const triage = await svc.triageMessage("msg-1", baseContext);

    expect(triage.messageId).toBe("msg-1");
    expect(triage.priorityScore).toBe(80);
    expect(triage.priorityFactors).toEqual([{ reason: "billing query", weight: 0.8 }]);
    expect(triage.topics).toEqual([{ label: "billing", confidence: 0.9, source: "ai" }]);
    expect(triage.sentiment).toBe("neutral");
    expect(triage.suggestedAction).toBe("reply");
    expect(triage.autoDraft).toBe("Hi Alice, I'd be happy to help with your invoice.");
    expect(triage.processedAtMs).toBe(NOW_MS);
  });

  it("uses defaults when no AI dep provided", async () => {
    const triage = await service.triageMessage("msg-2", baseContext);

    expect(triage.messageId).toBe("msg-2");
    expect(triage.priorityScore).toBe(50);
    expect(triage.priorityFactors).toEqual([]);
    expect(triage.topics).toEqual([]);
    expect(triage.sentiment).toBe("neutral");
    expect(triage.suggestedAction).toBeUndefined();
    expect(triage.autoDraft).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getTriageForMessage
// ---------------------------------------------------------------------------

describe("getTriageForMessage", () => {
  it("returns triage by messageId", async () => {
    await service.triageMessage("msg-3", baseContext);
    const found = await service.getTriageForMessage("msg-3");
    expect(found).not.toBeNull();
    expect(found!.messageId).toBe("msg-3");
  });

  it("returns null for missing messageId", async () => {
    const result = await service.getTriageForMessage("nonexistent");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bulkTriage
// ---------------------------------------------------------------------------

describe("bulkTriage", () => {
  it("processes multiple messages and returns all results", async () => {
    const items = [
      { messageId: "bulk-1", context: { messageBody: "Message one" } },
      { messageId: "bulk-2", context: { messageBody: "Message two" } },
      { messageId: "bulk-3", context: { messageBody: "Message three" } },
    ];

    const results = await service.bulkTriage(items);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.messageId)).toEqual(["bulk-1", "bulk-2", "bulk-3"]);
    for (const r of results) {
      expect(r.priorityScore).toBe(50); // default
    }

    // Verify all are persisted
    for (const id of ["bulk-1", "bulk-2", "bulk-3"]) {
      const found = await service.getTriageForMessage(id);
      expect(found).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// addManualTag
// ---------------------------------------------------------------------------

describe("addManualTag", () => {
  it("adds a tag with source 'manual' and confidence 1", async () => {
    await service.triageMessage("msg-tag", baseContext);
    const result = await service.addManualTag("msg-tag", "urgent");

    expect(result).not.toBeNull();
    expect(result!.topics).toContainEqual({ label: "urgent", confidence: 1, source: "manual" });
  });

  it("does not add duplicate labels", async () => {
    await service.triageMessage("msg-dup", baseContext);
    await service.addManualTag("msg-dup", "urgent");
    const result = await service.addManualTag("msg-dup", "urgent");

    const urgentTags = result!.topics.filter((t) => t.label === "urgent");
    expect(urgentTags).toHaveLength(1);
  });

  it("returns null for missing messageId", async () => {
    const result = await service.addManualTag("nonexistent", "urgent");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// removeTag
// ---------------------------------------------------------------------------

describe("removeTag", () => {
  it("removes a tag by label", async () => {
    await service.triageMessage("msg-rem", baseContext);
    await service.addManualTag("msg-rem", "to-remove");

    const before = await service.getTriageForMessage("msg-rem");
    expect(before!.topics.some((t) => t.label === "to-remove")).toBe(true);

    const result = await service.removeTag("msg-rem", "to-remove");
    expect(result!.topics.some((t) => t.label === "to-remove")).toBe(false);
  });

  it("returns null for missing messageId", async () => {
    const result = await service.removeTag("nonexistent", "label");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// regenerateDraft
// ---------------------------------------------------------------------------

describe("regenerateDraft", () => {
  it("updates only autoDraft field, preserving other triage fields", async () => {
    const runAITriage = vi.fn().mockResolvedValue(mockAIResult);
    const svc = new TriageService({
      storePath,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      broadcast,
      nowMs: () => NOW_MS,
      runAITriage,
    });

    await svc.triageMessage("msg-draft", baseContext);

    // Update mock to return different draft
    runAITriage.mockResolvedValue({
      ...mockAIResult,
      autoDraft: "Updated draft text",
    });

    const result = await svc.regenerateDraft("msg-draft", baseContext);

    expect(result).not.toBeNull();
    expect(result!.autoDraft).toBe("Updated draft text");
    // Other fields preserved
    expect(result!.priorityScore).toBe(80);
    expect(result!.sentiment).toBe("neutral");
  });

  it("returns null for missing messageId", async () => {
    const result = await service.regenerateDraft("nonexistent", baseContext);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe("events", () => {
  it("emits triage.completed event after triageMessage", async () => {
    await service.triageMessage("msg-evt", baseContext);

    const calls = broadcast.mock.calls;
    const completedCall = calls.find((c) => c[0] === "triage.completed");
    expect(completedCall).toBeDefined();
    expect((completedCall![1] as { messageId: string }).messageId).toBe("msg-evt");
  });

  it("emits triage.tag.added event after addManualTag", async () => {
    await service.triageMessage("msg-tag-evt", baseContext);
    await service.addManualTag("msg-tag-evt", "new-tag");

    const calls = broadcast.mock.calls;
    const tagCall = calls.find((c) => c[0] === "triage.tag.added");
    expect(tagCall).toBeDefined();
    expect((tagCall![1] as { label: string }).label).toBe("new-tag");
  });
});

// ---------------------------------------------------------------------------
// AI failure fallback
// ---------------------------------------------------------------------------

describe("AI failure handling", () => {
  it("falls back to defaults when AI call throws", async () => {
    const svc = new TriageService({
      storePath,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      broadcast,
      nowMs: () => NOW_MS,
      runAITriage: vi.fn().mockRejectedValue(new Error("AI service unavailable")),
    });

    const triage = await svc.triageMessage("msg-fail", baseContext);

    expect(triage.priorityScore).toBe(50);
    expect(triage.topics).toEqual([]);
    expect(triage.sentiment).toBe("neutral");
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe("concurrent writes", () => {
  it("serializes two simultaneous triages without losing data", async () => {
    const [t1, t2] = await Promise.all([
      service.triageMessage("concurrent-1", { messageBody: "First" }),
      service.triageMessage("concurrent-2", { messageBody: "Second" }),
    ]);

    expect(t1.messageId).toBe("concurrent-1");
    expect(t2.messageId).toBe("concurrent-2");

    const found1 = await service.getTriageForMessage("concurrent-1");
    const found2 = await service.getTriageForMessage("concurrent-2");

    expect(found1).not.toBeNull();
    expect(found2).not.toBeNull();
  });
});

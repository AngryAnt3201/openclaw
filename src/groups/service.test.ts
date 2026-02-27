// ---------------------------------------------------------------------------
// GroupService – Tests
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GroupServiceDeps } from "./service.js";
import { GroupService } from "./service.js";
import { readGroupStore } from "./store.js";

let tmpDir: string;
let storePath: string;
let clock: number;
let broadcasts: Array<{ event: string; payload: unknown }>;

function makeDeps(overrides?: Partial<GroupServiceDeps>): GroupServiceDeps {
  return {
    storePath,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    nowMs: () => clock,
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "group-svc-"));
  storePath = tmpDir;
  clock = 1000;
  broadcasts = [];
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// createGroup
// ---------------------------------------------------------------------------

describe("createGroup", () => {
  it("creates a group and emits event", async () => {
    const svc = new GroupService(makeDeps());
    const group = await svc.createGroup({
      label: "Test Group",
      agents: ["miranda", "coder"],
    });

    expect(group.id).toBeTruthy();
    expect(group.label).toBe("Test Group");
    expect(group.agents).toEqual(["miranda", "coder"]);
    expect(group.activation).toBe("always");
    expect(group.historyLimit).toBe(50);
    expect(group.createdAt).toBe(1000);
    expect(group.updatedAt).toBe(1000);

    const ev = broadcasts.find((b) => b.event === "group.created");
    expect(ev).toBeDefined();
    expect((ev!.payload as { id: string }).id).toBe(group.id);
  });

  it("persists across service instances", async () => {
    const svc = new GroupService(makeDeps());
    const group = await svc.createGroup({
      label: "Persistent",
      agents: ["miranda"],
    });

    const svc2 = new GroupService(makeDeps());
    const found = await svc2.getGroup(group.id);
    expect(found).not.toBeNull();
    expect(found!.label).toBe("Persistent");
  });

  it("rejects empty agents list", async () => {
    const svc = new GroupService(makeDeps());
    await expect(svc.createGroup({ label: "Bad Group", agents: [] })).rejects.toThrow(/agents/i);
  });
});

// ---------------------------------------------------------------------------
// getGroup
// ---------------------------------------------------------------------------

describe("getGroup", () => {
  it("returns null for missing group", async () => {
    const svc = new GroupService(makeDeps());
    const result = await svc.getGroup("nonexistent-id");
    expect(result).toBeNull();
  });

  it("returns existing group", async () => {
    const svc = new GroupService(makeDeps());
    const group = await svc.createGroup({
      label: "Findable",
      agents: ["miranda"],
    });

    const found = await svc.getGroup(group.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(group.id);
    expect(found!.label).toBe("Findable");
  });
});

// ---------------------------------------------------------------------------
// listGroups
// ---------------------------------------------------------------------------

describe("listGroups", () => {
  it("returns empty array initially", async () => {
    const svc = new GroupService(makeDeps());
    const list = await svc.listGroups();
    expect(list).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateGroup
// ---------------------------------------------------------------------------

describe("updateGroup", () => {
  it("updates label and agents", async () => {
    const svc = new GroupService(makeDeps());
    const group = await svc.createGroup({
      label: "Original",
      agents: ["miranda"],
    });

    clock = 2000;
    const updated = await svc.updateGroup(group.id, {
      label: "Updated",
      agents: ["miranda", "coder", "architect"],
    });

    expect(updated).not.toBeNull();
    expect(updated!.label).toBe("Updated");
    expect(updated!.agents).toEqual(["miranda", "coder", "architect"]);
    expect(updated!.updatedAt).toBe(2000);

    const ev = broadcasts.find((b) => b.event === "group.updated");
    expect(ev).toBeDefined();
  });

  it("returns null for missing group", async () => {
    const svc = new GroupService(makeDeps());
    const result = await svc.updateGroup("nonexistent", { label: "Nope" });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteGroup
// ---------------------------------------------------------------------------

describe("deleteGroup", () => {
  it("removes group and transcript, emits event", async () => {
    const svc = new GroupService(makeDeps());
    const group = await svc.createGroup({
      label: "Doomed",
      agents: ["miranda"],
    });

    // Append a message to create the transcript directory
    await svc.appendMessage(group.id, {
      role: "user",
      content: "hello",
    });

    // Verify transcript dir exists
    const transcriptDir = path.join(storePath, group.id);
    const dirExists = await fs.stat(transcriptDir).then(
      () => true,
      () => false,
    );
    expect(dirExists).toBe(true);

    broadcasts = [];
    const deleted = await svc.deleteGroup(group.id);
    expect(deleted).toBe(true);

    // Group gone from store
    const found = await svc.getGroup(group.id);
    expect(found).toBeNull();

    // Transcript directory cleaned up
    const dirGone = await fs.stat(transcriptDir).then(
      () => false,
      () => true,
    );
    expect(dirGone).toBe(true);

    // Event emitted
    const ev = broadcasts.find((b) => b.event === "group.deleted");
    expect(ev).toBeDefined();
  });

  it("returns false for missing group", async () => {
    const svc = new GroupService(makeDeps());
    const result = await svc.deleteGroup("nonexistent-id");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// appendMessage + getTranscript
// ---------------------------------------------------------------------------

describe("appendMessage + getTranscript", () => {
  it("appends and retrieves messages", async () => {
    const svc = new GroupService(makeDeps());
    const group = await svc.createGroup({
      label: "Chat",
      agents: ["miranda"],
    });

    const msg = await svc.appendMessage(group.id, {
      role: "user",
      content: "Hello world",
    });

    expect(msg.id).toBeTruthy();
    expect(msg.seq).toBe(1);
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello world");
    expect(msg.state).toBe("final");
    expect(msg.timestamp).toBe(1000);

    const transcript = await svc.getTranscript(group.id);
    expect(transcript).toHaveLength(1);
    expect(transcript[0]!.content).toBe("Hello world");
  });

  it("increments seq monotonically", async () => {
    const svc = new GroupService(makeDeps());
    const group = await svc.createGroup({
      label: "Seq Test",
      agents: ["miranda"],
    });

    const m1 = await svc.appendMessage(group.id, { role: "user", content: "First" });
    const m2 = await svc.appendMessage(group.id, {
      role: "agent",
      content: "Second",
      agentId: "miranda",
    });
    const m3 = await svc.appendMessage(group.id, { role: "user", content: "Third" });

    expect(m1.seq).toBe(1);
    expect(m2.seq).toBe(2);
    expect(m3.seq).toBe(3);
  });

  it("supports afterSeq filter", async () => {
    const svc = new GroupService(makeDeps());
    const group = await svc.createGroup({
      label: "Filter Test",
      agents: ["miranda"],
    });

    await svc.appendMessage(group.id, { role: "user", content: "One" });
    await svc.appendMessage(group.id, { role: "agent", content: "Two", agentId: "miranda" });
    await svc.appendMessage(group.id, { role: "user", content: "Three" });

    const filtered = await svc.getTranscript(group.id, { afterSeq: 1 });
    expect(filtered).toHaveLength(2);
    expect(filtered[0]!.content).toBe("Two");
    expect(filtered[1]!.content).toBe("Three");
  });

  it("supports limit filter", async () => {
    const svc = new GroupService(makeDeps());
    const group = await svc.createGroup({
      label: "Limit Test",
      agents: ["miranda"],
    });

    await svc.appendMessage(group.id, { role: "user", content: "One" });
    await svc.appendMessage(group.id, { role: "agent", content: "Two", agentId: "miranda" });
    await svc.appendMessage(group.id, { role: "user", content: "Three" });

    const limited = await svc.getTranscript(group.id, { limit: 2 });
    expect(limited).toHaveLength(2);
    // Limit takes the last N messages (most recent)
    expect(limited[0]!.content).toBe("Two");
    expect(limited[1]!.content).toBe("Three");
  });
});

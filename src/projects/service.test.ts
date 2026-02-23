// ---------------------------------------------------------------------------
// ProjectService – Tests
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProjectServiceDeps } from "./service.js";
import { ProjectService } from "./service.js";

let tmpDir: string;

function createTestService(dir: string) {
  const storePath = path.join(dir, "store.json");
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  const logs: string[] = [];
  const service = new ProjectService({
    storePath,
    log: {
      info: (msg) => logs.push(msg),
      warn: (msg) => logs.push(msg),
      error: (msg) => logs.push(msg),
    },
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
    nowMs: () => 1000,
  });
  return { service, broadcasts, logs, storePath };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-svc-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("create", () => {
  it("creates a project with defaults (UUID, cycled color, default icon, active status)", async () => {
    const { service } = createTestService(tmpDir);
    const project = await service.create({ name: "My Project" });

    expect(project.id).toBeTruthy();
    expect(project.id).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/,
    );
    expect(project.name).toBe("My Project");
    expect(project.description).toBe("");
    expect(project.color).toBe("#4F8CFF"); // first color preset
    expect(project.icon).toBe("\uD83D\uDCC1"); // default folder icon
    expect(project.status).toBe("active");
    expect(project.createdAtMs).toBe(1000);
    expect(project.updatedAtMs).toBe(1000);
  });

  it("cycles through color presets based on existing project count", async () => {
    const { service } = createTestService(tmpDir);
    const p1 = await service.create({ name: "First" });
    const p2 = await service.create({ name: "Second" });
    const p3 = await service.create({ name: "Third" });

    expect(p1.color).toBe("#4F8CFF"); // index 0
    expect(p2.color).toBe("#7C5CFC"); // index 1
    expect(p3.color).toBe("#FF6B6B"); // index 2
  });

  it("creates a project with all custom fields", async () => {
    const { service } = createTestService(tmpDir);
    const project = await service.create({
      name: "Custom Project",
      description: "A fully customized project",
      color: "#ABCDEF",
      icon: "\uD83D\uDE80",
    });

    expect(project.name).toBe("Custom Project");
    expect(project.description).toBe("A fully customized project");
    expect(project.color).toBe("#ABCDEF");
    expect(project.icon).toBe("\uD83D\uDE80");
    expect(project.status).toBe("active");
  });

  it("broadcasts project.created event", async () => {
    const { service, broadcasts } = createTestService(tmpDir);
    const project = await service.create({ name: "Broadcast Test" });

    const ev = broadcasts.find((b) => b.event === "project.created");
    expect(ev).toBeDefined();
    expect((ev!.payload as { id: string }).id).toBe(project.id);
    expect((ev!.payload as { name: string }).name).toBe("Broadcast Test");
  });

  it("logs project creation", async () => {
    const { service, logs } = createTestService(tmpDir);
    const project = await service.create({ name: "Log Test" });

    expect(logs.some((l) => l.includes(project.id) && l.includes("Log Test"))).toBe(true);
  });

  it("persists project to store file", async () => {
    const { service, storePath } = createTestService(tmpDir);
    const project = await service.create({ name: "Persisted" });

    // Read from a fresh service to verify persistence
    const { service: svc2 } = createTestService(tmpDir);
    const found = await svc2.get(project.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Persisted");
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("update", () => {
  it("updates project fields", async () => {
    const { service } = createTestService(tmpDir);
    const project = await service.create({ name: "Original" });

    const updated = await service.update(project.id, {
      name: "Updated Name",
      description: "New description",
      color: "#FF0000",
      icon: "\u2B50",
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated Name");
    expect(updated!.description).toBe("New description");
    expect(updated!.color).toBe("#FF0000");
    expect(updated!.icon).toBe("\u2B50");
    expect(updated!.updatedAtMs).toBe(1000);
  });

  it("returns null for non-existent project", async () => {
    const { service } = createTestService(tmpDir);
    const result = await service.update("nonexistent-id", { name: "Nope" });
    expect(result).toBeNull();
  });

  it("applies partial patches (only updates specified fields)", async () => {
    const { service } = createTestService(tmpDir);
    const project = await service.create({
      name: "Partial",
      description: "Original desc",
      color: "#111111",
    });

    const updated = await service.update(project.id, { name: "New Name" });

    expect(updated!.name).toBe("New Name");
    expect(updated!.description).toBe("Original desc"); // unchanged
    expect(updated!.color).toBe("#111111"); // unchanged
  });

  it("broadcasts project.updated event", async () => {
    const { service, broadcasts } = createTestService(tmpDir);
    const project = await service.create({ name: "Before" });
    broadcasts.length = 0; // clear create event

    await service.update(project.id, { name: "After" });

    const ev = broadcasts.find((b) => b.event === "project.updated");
    expect(ev).toBeDefined();
    expect((ev!.payload as { name: string }).name).toBe("After");
  });

  it("can update status", async () => {
    const { service } = createTestService(tmpDir);
    const project = await service.create({ name: "Status Test" });

    const updated = await service.update(project.id, { status: "archived" });
    expect(updated!.status).toBe("archived");
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("get", () => {
  it("returns the project when found", async () => {
    const { service } = createTestService(tmpDir);
    const project = await service.create({ name: "Find Me" });

    const found = await service.get(project.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(project.id);
    expect(found!.name).toBe("Find Me");
  });

  it("returns null when not found", async () => {
    const { service } = createTestService(tmpDir);
    const found = await service.get("does-not-exist");
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("list", () => {
  it("returns all projects when no filter is applied", async () => {
    const { service } = createTestService(tmpDir);
    await service.create({ name: "Project A" });
    await service.create({ name: "Project B" });
    await service.create({ name: "Project C" });

    const all = await service.list();
    expect(all).toHaveLength(3);
  });

  it("filters by status", async () => {
    const { service } = createTestService(tmpDir);
    const p1 = await service.create({ name: "Active One" });
    await service.create({ name: "Active Two" });
    await service.archive(p1.id);

    const active = await service.list({ status: "active" });
    expect(active).toHaveLength(1);
    expect(active[0]!.name).toBe("Active Two");

    const archived = await service.list({ status: "archived" });
    expect(archived).toHaveLength(1);
    expect(archived[0]!.name).toBe("Active One");
  });

  it("returns empty array when store is empty", async () => {
    const { service } = createTestService(tmpDir);
    const all = await service.list();
    expect(all).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

describe("archive", () => {
  it("sets project status to archived", async () => {
    const { service } = createTestService(tmpDir);
    const project = await service.create({ name: "To Archive" });

    const archived = await service.archive(project.id);
    expect(archived).not.toBeNull();
    expect(archived!.status).toBe("archived");

    // Verify persistence
    const found = await service.get(project.id);
    expect(found!.status).toBe("archived");
  });

  it("returns null for non-existent project", async () => {
    const { service } = createTestService(tmpDir);
    const result = await service.archive("nonexistent");
    expect(result).toBeNull();
  });

  it("broadcasts project.updated event (via update)", async () => {
    const { service, broadcasts } = createTestService(tmpDir);
    const project = await service.create({ name: "Archive Event" });
    broadcasts.length = 0;

    await service.archive(project.id);

    const ev = broadcasts.find((b) => b.event === "project.updated");
    expect(ev).toBeDefined();
    expect((ev!.payload as { status: string }).status).toBe("archived");
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("delete", () => {
  it("removes project from store", async () => {
    const { service } = createTestService(tmpDir);
    const project = await service.create({ name: "To Delete" });

    const deleted = await service.delete(project.id);
    expect(deleted).toBe(true);

    const found = await service.get(project.id);
    expect(found).toBeNull();

    const all = await service.list();
    expect(all).toHaveLength(0);
  });

  it("returns false for non-existent project", async () => {
    const { service } = createTestService(tmpDir);
    const deleted = await service.delete("nonexistent");
    expect(deleted).toBe(false);
  });

  it("broadcasts project.deleted event", async () => {
    const { service, broadcasts } = createTestService(tmpDir);
    const project = await service.create({ name: "Delete Event" });
    broadcasts.length = 0;

    await service.delete(project.id);

    const ev = broadcasts.find((b) => b.event === "project.deleted");
    expect(ev).toBeDefined();
    expect((ev!.payload as { id: string }).id).toBe(project.id);
  });

  it("logs project deletion", async () => {
    const { service, logs } = createTestService(tmpDir);
    const project = await service.create({ name: "Delete Log" });
    logs.length = 0;

    await service.delete(project.id);

    expect(logs.some((l) => l.includes(project.id) && l.includes("deleted"))).toBe(true);
  });

  it("does not affect other projects", async () => {
    const { service } = createTestService(tmpDir);
    const p1 = await service.create({ name: "Keep" });
    const p2 = await service.create({ name: "Remove" });

    await service.delete(p2.id);

    const remaining = await service.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(p1.id);
  });
});

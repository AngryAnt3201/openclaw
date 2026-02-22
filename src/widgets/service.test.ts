// ---------------------------------------------------------------------------
// WidgetService – Tests
// ---------------------------------------------------------------------------

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { WidgetServiceDeps } from "./service.js";
import { WidgetService } from "./service.js";

let tmpDir: string;
let svc: WidgetService;
let broadcasts: Array<{ event: string; payload: unknown }>;

function makeDeps(): WidgetServiceDeps {
  broadcasts = [];
  return {
    storePath: tmpDir,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    broadcast: (event, payload) => broadcasts.push({ event, payload }),
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "widget-svc-"));
  svc = new WidgetService(makeDeps());
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Registry (definitions)
// ---------------------------------------------------------------------------

describe("createDefinition", () => {
  it("creates and persists a definition", async () => {
    const def = await svc.createDefinition({
      type: "clock",
      name: "My Clock",
      category: "productivity",
    });

    expect(def.id).toBeTruthy();
    expect(def.type).toBe("clock");
    expect(def.name).toBe("My Clock");
    expect(def.category).toBe("productivity");
    expect(def.createdBy).toBe("user");
    expect(def.createdAt).toBeGreaterThan(0);
    // Size should come from DEFAULT_WIDGET_SIZES for "clock"
    expect(def.size.defaultW).toBe(200);
    expect(def.size.defaultH).toBe(120);

    // Persisted: re-read from a fresh service
    const svc2 = new WidgetService(makeDeps());
    const found = await svc2.getDefinition(def.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("My Clock");
  });

  it("broadcasts widget.definition.created", async () => {
    const def = await svc.createDefinition({
      type: "weather",
      name: "Weather",
    });

    const ev = broadcasts.find((b) => b.event === "widget.definition.created");
    expect(ev).toBeDefined();
    expect((ev!.payload as { id: string }).id).toBe(def.id);
  });
});

describe("listDefinitions", () => {
  it("returns all definitions", async () => {
    await svc.createDefinition({ type: "clock", name: "Clock" });
    await svc.createDefinition({ type: "weather", name: "Weather" });
    const all = await svc.listDefinitions();
    expect(all).toHaveLength(2);
  });

  it("filters by category", async () => {
    await svc.createDefinition({ type: "clock", name: "Clock", category: "productivity" });
    await svc.createDefinition({ type: "weather", name: "Weather", category: "media" });
    const filtered = await svc.listDefinitions({ category: "productivity" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.name).toBe("Clock");
  });
});

describe("getDefinition", () => {
  it("returns null for unknown ID", async () => {
    const result = await svc.getDefinition("nonexistent-id");
    expect(result).toBeNull();
  });
});

describe("deleteDefinition", () => {
  it("removes definition and broadcasts widget.definition.deleted", async () => {
    const def = await svc.createDefinition({ type: "clock", name: "Clock" });
    const deleted = await svc.deleteDefinition(def.id);
    expect(deleted).toBe(true);

    const ev = broadcasts.find((b) => b.event === "widget.definition.deleted");
    expect(ev).toBeDefined();
    expect((ev!.payload as { id: string }).id).toBe(def.id);

    const found = await svc.getDefinition(def.id);
    expect(found).toBeNull();
  });

  it("rejects system definitions", async () => {
    const def = await svc.createDefinition({
      type: "tasks",
      name: "Tasks",
      createdBy: "system",
    });
    const deleted = await svc.deleteDefinition(def.id);
    expect(deleted).toBe(false);

    // Should still exist
    const found = await svc.getDefinition(def.id);
    expect(found).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

describe("spawnInstance", () => {
  it("creates instance with valid definitionId", async () => {
    const def = await svc.createDefinition({ type: "clock", name: "Clock" });
    const inst = await svc.spawnInstance({ definitionId: def.id });

    expect(inst.id).toBeTruthy();
    expect(inst.definitionId).toBe(def.id);
    expect(inst.position).toEqual({ x: 0, y: 0 });
    expect(inst.dimensions.w).toBe(200); // clock defaultW
    expect(inst.pinned).toBe(false);
    expect(inst.minimized).toBe(false);
    expect(inst.createdAt).toBeGreaterThan(0);
  });

  it("rejects invalid definitionId", async () => {
    await expect(svc.spawnInstance({ definitionId: "does-not-exist" })).rejects.toThrow(
      "definition not found",
    );
  });

  it("broadcasts widget.instance.spawned", async () => {
    const def = await svc.createDefinition({ type: "clock", name: "Clock" });
    const inst = await svc.spawnInstance({ definitionId: def.id });

    const ev = broadcasts.find((b) => b.event === "widget.instance.spawned");
    expect(ev).toBeDefined();
    expect((ev!.payload as { id: string }).id).toBe(inst.id);
  });
});

describe("dismissInstance", () => {
  it("removes instance and broadcasts widget.instance.dismissed", async () => {
    const def = await svc.createDefinition({ type: "clock", name: "Clock" });
    const inst = await svc.spawnInstance({ definitionId: def.id });
    const dismissed = await svc.dismissInstance(inst.id);
    expect(dismissed).toBe(true);

    const ev = broadcasts.find((b) => b.event === "widget.instance.dismissed");
    expect(ev).toBeDefined();

    const list = await svc.listInstances();
    expect(list).toHaveLength(0);
  });
});

describe("listInstances", () => {
  it("returns all instances", async () => {
    const def = await svc.createDefinition({ type: "clock", name: "Clock" });
    await svc.spawnInstance({ definitionId: def.id });
    await svc.spawnInstance({ definitionId: def.id });
    const all = await svc.listInstances();
    expect(all).toHaveLength(2);
  });

  it("filters by deviceId", async () => {
    const def = await svc.createDefinition({ type: "clock", name: "Clock" });
    await svc.spawnInstance({ definitionId: def.id, deviceId: "desktop" });
    await svc.spawnInstance({ definitionId: def.id, deviceId: "mobile" });
    const filtered = await svc.listInstances({ deviceId: "desktop" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.deviceId).toBe("desktop");
  });
});

describe("updateInstance", () => {
  it("patches position", async () => {
    const def = await svc.createDefinition({ type: "clock", name: "Clock" });
    const inst = await svc.spawnInstance({ definitionId: def.id });

    const updated = await svc.updateInstance(inst.id, {
      position: { x: 100, y: 200 },
    });

    expect(updated).not.toBeNull();
    expect(updated!.position).toEqual({ x: 100, y: 200 });

    const ev = broadcasts.find((b) => b.event === "widget.instance.updated");
    expect(ev).toBeDefined();
  });

  it("merges data", async () => {
    const def = await svc.createDefinition({ type: "clock", name: "Clock" });
    const inst = await svc.spawnInstance({
      definitionId: def.id,
      data: { foo: "bar" },
    });

    const updated = await svc.updateInstance(inst.id, {
      data: { baz: 42 },
    });

    expect(updated).not.toBeNull();
    expect(updated!.data).toEqual({ foo: "bar", baz: 42 });
  });
});

// ---------------------------------------------------------------------------
// pushData
// ---------------------------------------------------------------------------

describe("pushData", () => {
  it("updates instance data and broadcasts widget.data.pushed", async () => {
    const def = await svc.createDefinition({ type: "clock", name: "Clock" });
    const inst = await svc.spawnInstance({ definitionId: def.id });

    const ok = await svc.pushData(inst.id, { temperature: 72 });
    expect(ok).toBe(true);

    const ev = broadcasts.find((b) => b.event === "widget.data.pushed");
    expect(ev).toBeDefined();
    expect((ev!.payload as { instanceId: string }).instanceId).toBe(inst.id);

    // Verify persisted
    const list = await svc.listInstances();
    expect(list[0]!.data).toEqual({ temperature: 72 });
  });
});

// ---------------------------------------------------------------------------
// Data Sources
// ---------------------------------------------------------------------------

describe("createDataSource", () => {
  it("creates and persists a data source", async () => {
    const src = await svc.createDataSource({ name: "CPU Monitor" });

    expect(src.id).toBeTruthy();
    expect(src.name).toBe("CPU Monitor");
    expect(src.createdBy).toBe("user");

    const ev = broadcasts.find((b) => b.event === "widget.stream.created");
    expect(ev).toBeDefined();

    // Persisted
    const found = await svc.getDataSource(src.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("CPU Monitor");
  });
});

describe("pushToStream", () => {
  it("updates lastValue and broadcasts widget.stream.pushed", async () => {
    const src = await svc.createDataSource({ name: "Temp" });
    const ok = await svc.pushToStream(src.id, { celsius: 22 });
    expect(ok).toBe(true);

    const ev = broadcasts.find((b) => b.event === "widget.stream.pushed");
    expect(ev).toBeDefined();
    expect((ev!.payload as { streamId: string }).streamId).toBe(src.id);

    const updated = await svc.getDataSource(src.id);
    expect(updated!.lastValue).toEqual({ celsius: 22 });
    expect(updated!.lastUpdated).toBeGreaterThan(0);
  });
});

describe("deleteDataSource", () => {
  it("removes and broadcasts widget.stream.deleted", async () => {
    const src = await svc.createDataSource({ name: "To Delete" });
    const ok = await svc.deleteDataSource(src.id);
    expect(ok).toBe(true);

    const ev = broadcasts.find((b) => b.event === "widget.stream.deleted");
    expect(ev).toBeDefined();

    const found = await svc.getDataSource(src.id);
    expect(found).toBeNull();
  });
});

describe("listDataSources", () => {
  it("returns all sources", async () => {
    await svc.createDataSource({ name: "A" });
    await svc.createDataSource({ name: "B" });
    const all = await svc.listDataSources();
    expect(all).toHaveLength(2);
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pipeline, PipelineCreate, PipelineEvent } from "./types.js";
import { PipelineService, type PipelineServiceOpts } from "./service.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-pipe-svc-"));
  return {
    dir,
    storePath: path.join(dir, "store.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function makeService(storePath: string, opts?: { nowMs?: () => number }) {
  const events: PipelineEvent[] = [];

  const serviceOpts: PipelineServiceOpts = {
    storePath,
    onEvent: (event) => events.push(event),
    nowMs: opts?.nowMs,
  };

  return { service: new PipelineService(serviceOpts), events };
}

const baseInput: PipelineCreate = {
  name: "Test Pipeline",
  description: "A test pipeline",
};

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("PipelineService.create", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates a pipeline with default values", async () => {
    const { service } = makeService(storePath);
    const p = await service.create(baseInput);

    expect(p.id).toBeTruthy();
    expect(p.name).toBe("Test Pipeline");
    expect(p.description).toBe("A test pipeline");
    expect(p.status).toBe("draft");
    expect(p.enabled).toBe(false);
    expect(p.nodes).toEqual([]);
    expect(p.edges).toEqual([]);
    expect(p.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(p.runCount).toBe(0);
    expect(p.createdAtMs).toBeGreaterThan(0);
    expect(p.updatedAtMs).toBe(p.createdAtMs);
  });

  it("creates a pipeline with provided optional fields", async () => {
    const { service } = makeService(storePath);
    const p = await service.create({
      name: "Custom",
      description: "Custom desc",
      enabled: true,
      viewport: { x: 10, y: 20, zoom: 2 },
    });

    expect(p.name).toBe("Custom");
    expect(p.description).toBe("Custom desc");
    // Even if enabled is passed, status should still be draft
    expect(p.status).toBe("draft");
    expect(p.enabled).toBe(true);
    expect(p.viewport).toEqual({ x: 10, y: 20, zoom: 2 });
  });

  it("emits a pipeline_created event on create", async () => {
    const { service, events } = makeService(storePath);
    const p = await service.create(baseInput);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("pipeline_created");
    expect(events[0]!.pipelineId).toBe(p.id);
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("PipelineService.list", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns an empty array when no pipelines exist", async () => {
    const { service } = makeService(storePath);
    const list = await service.list();
    expect(list).toEqual([]);
  });

  it("returns all created pipelines", async () => {
    const { service } = makeService(storePath);
    await service.create({ name: "A" });
    await service.create({ name: "B" });

    const list = await service.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toEqual(["A", "B"]);
  });
});

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe("PipelineService.get", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns a pipeline by id", async () => {
    const { service } = makeService(storePath);
    const created = await service.create(baseInput);

    const found = await service.get(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe("Test Pipeline");
  });

  it("returns null for a nonexistent id", async () => {
    const { service } = makeService(storePath);
    const found = await service.get("nonexistent-id");
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("PipelineService.update", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("updates pipeline fields", async () => {
    let tick = 1000;
    const { service } = makeService(storePath, { nowMs: () => tick });
    const created = await service.create(baseInput);

    tick = 2000;
    const updated = await service.update(created.id, {
      name: "Renamed",
      description: "Updated desc",
    });

    expect(updated.name).toBe("Renamed");
    expect(updated.description).toBe("Updated desc");
    expect(updated.updatedAtMs).toBe(2000);
  });

  it("updates nodes and edges", async () => {
    const { service } = makeService(storePath);
    const created = await service.create(baseInput);

    const nodes = [
      {
        id: "n1",
        type: "manual" as const,
        label: "Start",
        config: { kind: "manual" as const },
        position: { x: 0, y: 0 },
        state: { status: "idle" as const, retryCount: 0 },
      },
    ];
    const edges = [{ id: "e1", source: "n1", target: "n2" }];

    const updated = await service.update(created.id, { nodes, edges });
    expect(updated.nodes).toHaveLength(1);
    expect(updated.nodes[0]!.id).toBe("n1");
    expect(updated.edges).toHaveLength(1);
  });

  it("throws when updating a nonexistent pipeline", async () => {
    const { service } = makeService(storePath);
    await expect(service.update("bad-id", { name: "nope" })).rejects.toThrow(
      "Pipeline not found: bad-id",
    );
  });

  it("emits a pipeline_updated event on update", async () => {
    const { service, events } = makeService(storePath);
    const created = await service.create(baseInput);
    events.length = 0; // clear create event

    await service.update(created.id, { name: "Changed" });
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("pipeline_updated");
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("PipelineService.delete", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("deletes a pipeline", async () => {
    const { service } = makeService(storePath);
    const created = await service.create(baseInput);

    await service.delete(created.id);

    const found = await service.get(created.id);
    expect(found).toBeNull();
    const list = await service.list();
    expect(list).toHaveLength(0);
  });

  it("is a no-op for a nonexistent pipeline", async () => {
    const { service } = makeService(storePath);
    // Should not throw
    await service.delete("nonexistent-id");
  });

  it("emits a pipeline_deleted event on delete", async () => {
    const { service, events } = makeService(storePath);
    const created = await service.create(baseInput);
    events.length = 0;

    await service.delete(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("pipeline_deleted");
  });
});

// ---------------------------------------------------------------------------
// activate
// ---------------------------------------------------------------------------

describe("PipelineService.activate", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("sets status to active and enabled to true", async () => {
    const { service } = makeService(storePath);
    const created = await service.create(baseInput);
    expect(created.status).toBe("draft");
    expect(created.enabled).toBe(false);

    const activated = await service.activate(created.id);
    expect(activated.status).toBe("active");
    expect(activated.enabled).toBe(true);
  });

  it("throws when activating a nonexistent pipeline", async () => {
    const { service } = makeService(storePath);
    await expect(service.activate("bad-id")).rejects.toThrow("Pipeline not found: bad-id");
  });

  it("emits a pipeline_enabled event on activate", async () => {
    const { service, events } = makeService(storePath);
    const created = await service.create(baseInput);
    events.length = 0;

    await service.activate(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("pipeline_enabled");
  });
});

// ---------------------------------------------------------------------------
// deactivate
// ---------------------------------------------------------------------------

describe("PipelineService.deactivate", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("sets status to paused and enabled to false", async () => {
    const { service } = makeService(storePath);
    const created = await service.create(baseInput);
    await service.activate(created.id);

    const deactivated = await service.deactivate(created.id);
    expect(deactivated.status).toBe("paused");
    expect(deactivated.enabled).toBe(false);
  });

  it("throws when deactivating a nonexistent pipeline", async () => {
    const { service } = makeService(storePath);
    await expect(service.deactivate("bad-id")).rejects.toThrow("Pipeline not found: bad-id");
  });

  it("emits a pipeline_disabled event on deactivate", async () => {
    const { service, events } = makeService(storePath);
    const created = await service.create(baseInput);
    await service.activate(created.id);
    events.length = 0;

    await service.deactivate(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("pipeline_disabled");
  });
});

// ---------------------------------------------------------------------------
// persistence across reloads
// ---------------------------------------------------------------------------

describe("PipelineService persistence", () => {
  let storePath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmp = await makeTmpStore();
    storePath = tmp.storePath;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("persists data across service instances", async () => {
    const { service: svc1 } = makeService(storePath);
    const created = await svc1.create(baseInput);
    await svc1.activate(created.id);

    // Create a new service instance pointing at the same store
    const { service: svc2 } = makeService(storePath);
    const found = await svc2.get(created.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe("Test Pipeline");
    expect(found!.status).toBe("active");
    expect(found!.enabled).toBe(true);
  });

  it("persists list across service instances", async () => {
    const { service: svc1 } = makeService(storePath);
    await svc1.create({ name: "P1" });
    await svc1.create({ name: "P2" });

    const { service: svc2 } = makeService(storePath);
    const list = await svc2.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toEqual(["P1", "P2"]);
  });
});

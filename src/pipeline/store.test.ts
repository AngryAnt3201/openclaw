import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineStoreFile, Pipeline, PipelineEvent } from "./types.js";
import {
  appendPipelineEvent,
  loadPipelineStore,
  readPipelineEvents,
  resolvePipelineEventsDir,
  resolvePipelineEventLogPath,
  resolvePipelineStorePath,
  savePipelineStore,
} from "./store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let storePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipeline-store-"));
  storePath = path.join(tmpDir, "store.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makePipeline(overrides?: Partial<Pipeline>): Pipeline {
  return {
    id: "pipe-1",
    name: "Test Pipeline",
    description: "A test pipeline",
    enabled: true,
    nodes: [],
    edges: [],
    status: "draft",
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAtMs: 1000,
    updatedAtMs: 1000,
    runCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolvePipelineStorePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default path under ~/.openclaw/pipelines/ when no custom path given", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolvePipelineStorePath();
    expect(result).toBe(path.join("/home/testuser", ".openclaw", "pipelines", "store.json"));
  });

  it("resolves custom path when provided", () => {
    const result = resolvePipelineStorePath("/custom/path/pipelines.json");
    expect(result).toBe(path.resolve("/custom/path/pipelines.json"));
  });
});

describe("resolvePipelineEventsDir", () => {
  it("returns events dir relative to store parent", () => {
    const result = resolvePipelineEventsDir("/home/user/.openclaw/pipelines/store.json");
    expect(result).toBe(path.join("/home/user/.openclaw/pipelines", "events"));
  });
});

describe("resolvePipelineEventLogPath", () => {
  it("returns JSONL path for pipeline ID", () => {
    const result = resolvePipelineEventLogPath(
      "/home/user/.openclaw/pipelines/store.json",
      "pipe-abc",
    );
    expect(result).toBe(path.join("/home/user/.openclaw/pipelines", "events", "pipe-abc.jsonl"));
  });
});

// ---------------------------------------------------------------------------
// Store read (loadPipelineStore)
// ---------------------------------------------------------------------------

describe("loadPipelineStore", () => {
  it("returns empty store when file does not exist", async () => {
    const store = await loadPipelineStore(storePath);
    expect(store).toEqual({ version: 1, pipelines: [] });
  });

  it("reads a valid store file", async () => {
    const data: PipelineStoreFile = {
      version: 1,
      pipelines: [makePipeline({ id: "pipe-1", name: "My Pipeline" })],
    };
    await fs.writeFile(storePath, JSON.stringify(data), "utf-8");
    const store = await loadPipelineStore(storePath);
    expect(store.version).toBe(1);
    expect(store.pipelines).toHaveLength(1);
    expect(store.pipelines[0]!.id).toBe("pipe-1");
    expect(store.pipelines[0]!.name).toBe("My Pipeline");
  });

  it("returns empty store when file contains invalid JSON", async () => {
    await fs.writeFile(storePath, "{ broken json", "utf-8");
    const store = await loadPipelineStore(storePath);
    expect(store).toEqual({ version: 1, pipelines: [] });
  });

  it("returns empty store when version is wrong", async () => {
    await fs.writeFile(storePath, JSON.stringify({ version: 99, pipelines: [] }), "utf-8");
    const store = await loadPipelineStore(storePath);
    expect(store).toEqual({ version: 1, pipelines: [] });
  });

  it("returns empty store when pipelines is not an array", async () => {
    await fs.writeFile(storePath, JSON.stringify({ version: 1, pipelines: "not-array" }), "utf-8");
    const store = await loadPipelineStore(storePath);
    expect(store).toEqual({ version: 1, pipelines: [] });
  });
});

// ---------------------------------------------------------------------------
// Store write (savePipelineStore)
// ---------------------------------------------------------------------------

describe("savePipelineStore", () => {
  it("writes store file atomically", async () => {
    const data: PipelineStoreFile = {
      version: 1,
      pipelines: [makePipeline({ id: "pipe-w", name: "Written Pipeline" })],
    };
    await savePipelineStore(storePath, data);
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.pipelines).toHaveLength(1);
    expect(parsed.pipelines[0].name).toBe("Written Pipeline");
  });

  it("creates parent directories if they don't exist", async () => {
    const deep = path.join(tmpDir, "a", "b", "c", "store.json");
    await savePipelineStore(deep, { version: 1, pipelines: [] });
    const raw = await fs.readFile(deep, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, pipelines: [] });
  });

  it("no .tmp file left behind after write", async () => {
    await savePipelineStore(storePath, { version: 1, pipelines: [] });
    const files = await fs.readdir(path.dirname(storePath));
    expect(files.filter((f) => f.includes(".tmp"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Save + load round-trip
// ---------------------------------------------------------------------------

describe("save + load round-trip", () => {
  it("saves and loads pipelines correctly", async () => {
    const pipeline = makePipeline({
      id: "pipe-rt",
      name: "Round Trip",
      description: "Testing round trip",
      enabled: false,
      status: "active",
      runCount: 7,
    });
    const data: PipelineStoreFile = { version: 1, pipelines: [pipeline] };

    await savePipelineStore(storePath, data);
    const loaded = await loadPipelineStore(storePath);

    expect(loaded.version).toBe(1);
    expect(loaded.pipelines).toHaveLength(1);
    expect(loaded.pipelines[0]).toEqual(pipeline);
  });
});

// ---------------------------------------------------------------------------
// Empty store factory isolation
// ---------------------------------------------------------------------------

describe("empty store factory", () => {
  it("returns distinct arrays for each call (no shared ref bug)", async () => {
    const store1 = await loadPipelineStore("/nonexistent/a.json");
    const store2 = await loadPipelineStore("/nonexistent/b.json");
    expect(store1.pipelines).not.toBe(store2.pipelines);
  });
});

// ---------------------------------------------------------------------------
// Concurrent writes
// ---------------------------------------------------------------------------

describe("concurrent saves", () => {
  it("atomic writes don't corrupt on concurrent saves (10 parallel writes)", async () => {
    const writes = Array.from({ length: 10 }, (_, i) => {
      const store: PipelineStoreFile = {
        version: 1,
        pipelines: [makePipeline({ id: `pipe-${i}`, name: `Pipeline ${i}` })],
      };
      return savePipelineStore(storePath, store);
    });

    await Promise.all(writes);

    // The file should be valid JSON — one of the 10 writes should have won
    const raw = await fs.readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw) as PipelineStoreFile;
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.pipelines)).toBe(true);
    expect(parsed.pipelines).toHaveLength(1);
    // The winning pipeline should be one of pipe-0 through pipe-9
    expect(parsed.pipelines[0]!.id).toMatch(/^pipe-\d$/);
  });
});

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

describe("appendPipelineEvent + readPipelineEvents", () => {
  it("appends and reads events", async () => {
    const event1: PipelineEvent = {
      id: "evt-1",
      pipelineId: "pipe-1",
      type: "pipeline_created",
      timestamp: 1000,
      message: "Created",
    };
    const event2: PipelineEvent = {
      id: "evt-2",
      pipelineId: "pipe-1",
      type: "run_started",
      timestamp: 2000,
      message: "Run started",
      runId: "run-1",
    };

    await appendPipelineEvent(storePath, event1);
    await appendPipelineEvent(storePath, event2);

    const events = await readPipelineEvents(storePath, "pipe-1");
    expect(events).toHaveLength(2);
    expect(events[0]!.id).toBe("evt-1");
    expect(events[1]!.id).toBe("evt-2");
    expect(events[1]!.runId).toBe("run-1");
  });

  it("returns empty array when no events exist", async () => {
    const events = await readPipelineEvents(storePath, "nonexistent");
    expect(events).toEqual([]);
  });

  it("respects limit parameter (returns last N)", async () => {
    for (let i = 0; i < 10; i++) {
      await appendPipelineEvent(storePath, {
        id: `evt-${i}`,
        pipelineId: "pipe-1",
        type: "node_started",
        timestamp: i * 1000,
        message: `Event ${i}`,
        nodeId: `node-${i}`,
      });
    }
    const events = await readPipelineEvents(storePath, "pipe-1", { limit: 3 });
    expect(events).toHaveLength(3);
    expect(events[0]!.id).toBe("evt-7");
    expect(events[2]!.id).toBe("evt-9");
  });

  it("skips malformed JSONL lines", async () => {
    const eventsDir = resolvePipelineEventsDir(storePath);
    await fs.mkdir(eventsDir, { recursive: true });
    const logPath = resolvePipelineEventLogPath(storePath, "pipe-1");
    await fs.writeFile(
      logPath,
      '{"id":"evt-1","pipelineId":"pipe-1","type":"pipeline_created","timestamp":1000,"message":"ok"}\n' +
        "BROKEN LINE\n" +
        '{"id":"evt-2","pipelineId":"pipe-1","type":"pipeline_updated","timestamp":2000,"message":"ok2"}\n',
      "utf-8",
    );
    const events = await readPipelineEvents(storePath, "pipe-1");
    expect(events).toHaveLength(2);
    expect(events[0]!.id).toBe("evt-1");
    expect(events[1]!.id).toBe("evt-2");
  });

  it("creates events directory automatically", async () => {
    await appendPipelineEvent(storePath, {
      id: "evt-1",
      pipelineId: "pipe-1",
      type: "pipeline_created",
      timestamp: 1000,
      message: "Created",
    });
    const events = await readPipelineEvents(storePath, "pipe-1");
    expect(events).toHaveLength(1);
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskEvent, TaskStoreFile } from "./types.js";
import {
  appendTaskEvent,
  readTaskEvents,
  readTaskStore,
  resolveTaskEventsDir,
  resolveTaskEventLogPath,
  resolveTaskScreenshotDir,
  resolveTaskStorePath,
  writeTaskStore,
} from "./store.js";

async function makeTmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-task-store-"));
  return {
    dir,
    storePath: path.join(dir, "store.json"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolveTaskStorePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default path under ~/.openclaw/tasks/ when no custom path given", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolveTaskStorePath();
    expect(result).toBe(path.join("/home/testuser", ".openclaw", "tasks", "store.json"));
  });

  it("resolves custom path when provided", () => {
    const result = resolveTaskStorePath("/custom/path/tasks.json");
    expect(result).toBe(path.resolve("/custom/path/tasks.json"));
  });
});

describe("resolveTaskEventsDir", () => {
  it("returns events dir relative to store parent", () => {
    const result = resolveTaskEventsDir("/home/user/.openclaw/tasks/store.json");
    expect(result).toBe(path.join("/home/user/.openclaw/tasks", "events"));
  });
});

describe("resolveTaskEventLogPath", () => {
  it("returns JSONL path for task ID", () => {
    const result = resolveTaskEventLogPath("/home/user/.openclaw/tasks/store.json", "task-abc");
    expect(result).toBe(path.join("/home/user/.openclaw/tasks", "events", "task-abc.jsonl"));
  });
});

describe("resolveTaskScreenshotDir", () => {
  it("returns screenshot dir for task ID", () => {
    const result = resolveTaskScreenshotDir("/home/user/.openclaw/tasks/store.json", "task-abc");
    expect(result).toBe(path.join("/home/user/.openclaw/tasks", "screenshots", "task-abc"));
  });
});

// ---------------------------------------------------------------------------
// Store read/write
// ---------------------------------------------------------------------------

describe("readTaskStore", () => {
  it("returns empty store when file does not exist", async () => {
    const tmp = await makeTmpStore();
    const store = await readTaskStore(tmp.storePath);
    expect(store).toEqual({ version: 1, tasks: [] });
    await tmp.cleanup();
  });

  it("reads valid store file", async () => {
    const tmp = await makeTmpStore();
    const data: TaskStoreFile = {
      version: 1,
      tasks: [
        {
          id: "t1",
          title: "Test Task",
          description: "desc",
          status: "pending",
          priority: "medium",
          type: "instruction",
          source: "user",
          agentId: "default",
          createdAtMs: 1000,
          updatedAtMs: 1000,
        },
      ],
    };
    await fs.mkdir(path.dirname(tmp.storePath), { recursive: true });
    await fs.writeFile(tmp.storePath, JSON.stringify(data), "utf-8");
    const store = await readTaskStore(tmp.storePath);
    expect(store.version).toBe(1);
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0]!.id).toBe("t1");
    expect(store.tasks[0]!.title).toBe("Test Task");
    await tmp.cleanup();
  });

  it("returns empty store when file contains invalid JSON", async () => {
    const tmp = await makeTmpStore();
    await fs.mkdir(path.dirname(tmp.storePath), { recursive: true });
    await fs.writeFile(tmp.storePath, "{ broken json", "utf-8");
    const store = await readTaskStore(tmp.storePath);
    expect(store).toEqual({ version: 1, tasks: [] });
    await tmp.cleanup();
  });

  it("returns empty store when version is wrong", async () => {
    const tmp = await makeTmpStore();
    await fs.mkdir(path.dirname(tmp.storePath), { recursive: true });
    await fs.writeFile(tmp.storePath, JSON.stringify({ version: 99, tasks: [] }), "utf-8");
    const store = await readTaskStore(tmp.storePath);
    expect(store).toEqual({ version: 1, tasks: [] });
    await tmp.cleanup();
  });

  it("returns empty store when tasks is not an array", async () => {
    const tmp = await makeTmpStore();
    await fs.mkdir(path.dirname(tmp.storePath), { recursive: true });
    await fs.writeFile(tmp.storePath, JSON.stringify({ version: 1, tasks: "not-array" }), "utf-8");
    const store = await readTaskStore(tmp.storePath);
    expect(store).toEqual({ version: 1, tasks: [] });
    await tmp.cleanup();
  });
});

describe("writeTaskStore", () => {
  it("writes store file atomically", async () => {
    const tmp = await makeTmpStore();
    const data: TaskStoreFile = {
      version: 1,
      tasks: [
        {
          id: "t1",
          title: "Written Task",
          description: "",
          status: "pending",
          priority: "low",
          type: "instruction",
          source: "user",
          agentId: "default",
          createdAtMs: 2000,
          updatedAtMs: 2000,
        },
      ],
    };
    await writeTaskStore(tmp.storePath, data);
    const raw = await fs.readFile(tmp.storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].title).toBe("Written Task");
    await tmp.cleanup();
  });

  it("creates parent directories if they don't exist", async () => {
    const tmp = await makeTmpStore();
    const deep = path.join(tmp.dir, "a", "b", "c", "store.json");
    await writeTaskStore(deep, { version: 1, tasks: [] });
    const raw = await fs.readFile(deep, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, tasks: [] });
    await tmp.cleanup();
  });

  it("no .tmp file left behind after write", async () => {
    const tmp = await makeTmpStore();
    await writeTaskStore(tmp.storePath, { version: 1, tasks: [] });
    const files = await fs.readdir(path.dirname(tmp.storePath));
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

describe("appendTaskEvent / readTaskEvents", () => {
  it("appends and reads events", async () => {
    const tmp = await makeTmpStore();
    const event1: TaskEvent = {
      id: "ev1",
      taskId: "t1",
      type: "status_change",
      timestamp: 1000,
      message: "Created",
    };
    const event2: TaskEvent = {
      id: "ev2",
      taskId: "t1",
      type: "progress",
      timestamp: 2000,
      message: "50%",
      data: { progress: 50 },
    };

    await appendTaskEvent(tmp.storePath, event1);
    await appendTaskEvent(tmp.storePath, event2);

    const events = await readTaskEvents(tmp.storePath, "t1");
    expect(events).toHaveLength(2);
    expect(events[0]!.id).toBe("ev1");
    expect(events[1]!.id).toBe("ev2");
    expect(events[1]!.data).toEqual({ progress: 50 });
    await tmp.cleanup();
  });

  it("returns empty array when no events exist", async () => {
    const tmp = await makeTmpStore();
    const events = await readTaskEvents(tmp.storePath, "nonexistent");
    expect(events).toEqual([]);
    await tmp.cleanup();
  });

  it("respects limit parameter", async () => {
    const tmp = await makeTmpStore();
    for (let i = 0; i < 10; i++) {
      await appendTaskEvent(tmp.storePath, {
        id: `ev${i}`,
        taskId: "t1",
        type: "progress",
        timestamp: i * 1000,
        message: `Event ${i}`,
      });
    }
    const events = await readTaskEvents(tmp.storePath, "t1", { limit: 3 });
    expect(events).toHaveLength(3);
    // Should return last 3 events
    expect(events[0]!.id).toBe("ev7");
    expect(events[2]!.id).toBe("ev9");
    await tmp.cleanup();
  });

  it("skips malformed JSONL lines", async () => {
    const tmp = await makeTmpStore();
    const eventsDir = resolveTaskEventsDir(tmp.storePath);
    await fs.mkdir(eventsDir, { recursive: true });
    const logPath = resolveTaskEventLogPath(tmp.storePath, "t1");
    await fs.writeFile(
      logPath,
      '{"id":"ev1","taskId":"t1","type":"progress","timestamp":1000,"message":"ok"}\n' +
        "BROKEN LINE\n" +
        '{"id":"ev2","taskId":"t1","type":"progress","timestamp":2000,"message":"ok2"}\n',
      "utf-8",
    );
    const events = await readTaskEvents(tmp.storePath, "t1");
    expect(events).toHaveLength(2);
    expect(events[0]!.id).toBe("ev1");
    expect(events[1]!.id).toBe("ev2");
    await tmp.cleanup();
  });

  it("creates events directory automatically", async () => {
    const tmp = await makeTmpStore();
    // Events dir doesn't exist yet
    await appendTaskEvent(tmp.storePath, {
      id: "ev1",
      taskId: "t1",
      type: "status_change",
      timestamp: 1000,
      message: "Created",
    });
    const events = await readTaskEvents(tmp.storePath, "t1");
    expect(events).toHaveLength(1);
    await tmp.cleanup();
  });
});

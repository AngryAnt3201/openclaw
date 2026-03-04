import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkspaceService, type WorkspaceServiceDeps } from "./service.js";

let tmpDir: string;
let storePath: string;
let events: Array<{ event: string; payload: unknown }>;
let logs: string[];

function createDeps(overrides?: Partial<WorkspaceServiceDeps>): WorkspaceServiceDeps {
  return {
    storePath,
    log: {
      info: (msg) => logs.push(`INFO: ${msg}`),
      warn: (msg) => logs.push(`WARN: ${msg}`),
      error: (msg) => logs.push(`ERROR: ${msg}`),
    },
    broadcast: (event, payload) => events.push({ event, payload }),
    nowMs: () => 1000,
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-svc-"));
  storePath = path.join(tmpDir, "store.json");
  events = [];
  logs = [];
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("create", () => {
  it("creates a workspace with an auto-generated UUID", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({ name: "Frontend" });
    expect(ws.id).toBeDefined();
    expect(ws.name).toBe("Frontend");
    expect(ws.directories).toEqual([]);
    expect(ws.bindings).toEqual([]);
    expect(ws.createdAtMs).toBe(1000);
  });

  it("creates directories when provided in input", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({
      name: "Full Stack",
      directories: [
        { deviceId: "user@host", remotePath: "/app/frontend", label: "frontend" },
        { deviceId: "user@host", remotePath: "/app/api", label: "api", primary: true },
      ],
    });
    expect(ws.directories).toHaveLength(2);
    expect(ws.directories[0]!.mountMethod).toBe("sshfs");
    expect(ws.directories[1]!.primary).toBe(true);
    // First dir defaults to primary when no explicit primary given in first entry
    expect(ws.directories[0]!.primary).toBe(true); // first defaults to primary
  });

  it("broadcasts workspace.created event", async () => {
    const svc = new WorkspaceService(createDeps());
    await svc.create({ name: "Test" });
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("workspace.created");
  });
});

describe("get", () => {
  it("returns workspace by ID", async () => {
    const svc = new WorkspaceService(createDeps());
    const created = await svc.create({ name: "Test" });
    const found = await svc.get(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test");
  });

  it("returns null for missing ID", async () => {
    const svc = new WorkspaceService(createDeps());
    const found = await svc.get("nonexistent");
    expect(found).toBeNull();
  });
});

describe("list", () => {
  it("lists all workspaces", async () => {
    const svc = new WorkspaceService(createDeps());
    await svc.create({ name: "A" });
    await svc.create({ name: "B" });
    const list = await svc.list();
    expect(list).toHaveLength(2);
  });

  it("filters by tag", async () => {
    const svc = new WorkspaceService(createDeps());
    await svc.create({ name: "A", tags: ["frontend"] });
    await svc.create({ name: "B", tags: ["backend"] });
    const filtered = await svc.list({ tag: "frontend" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.name).toBe("A");
  });

  it("filters by limit", async () => {
    const svc = new WorkspaceService(createDeps());
    await svc.create({ name: "A" });
    await svc.create({ name: "B" });
    await svc.create({ name: "C" });
    const limited = await svc.list({ limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

describe("update", () => {
  it("updates workspace fields", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({ name: "Old" });
    const updated = await svc.update(ws.id, { name: "New", description: "desc" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("New");
    expect(updated!.description).toBe("desc");
  });

  it("returns null for missing workspace", async () => {
    const svc = new WorkspaceService(createDeps());
    const result = await svc.update("nonexistent", { name: "X" });
    expect(result).toBeNull();
  });
});

describe("delete", () => {
  it("deletes a workspace", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({ name: "Delete Me" });
    const deleted = await svc.delete(ws.id);
    expect(deleted).toBe(true);
    const found = await svc.get(ws.id);
    expect(found).toBeNull();
  });

  it("returns false for missing workspace", async () => {
    const svc = new WorkspaceService(createDeps());
    expect(await svc.delete("nonexistent")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Directory management
// ---------------------------------------------------------------------------

describe("addDirectory", () => {
  it("adds a directory to a workspace", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({ name: "Test" });
    const dir = await svc.addDirectory(ws.id, {
      deviceId: "user@host",
      remotePath: "/app",
      label: "app",
    });
    expect(dir).not.toBeNull();
    expect(dir!.label).toBe("app");
    expect(dir!.mountMethod).toBe("sshfs");

    const updated = await svc.get(ws.id);
    expect(updated!.directories).toHaveLength(1);
  });

  it("returns null for missing workspace", async () => {
    const svc = new WorkspaceService(createDeps());
    const dir = await svc.addDirectory("nonexistent", {
      deviceId: "host",
      remotePath: "/",
      label: "x",
    });
    expect(dir).toBeNull();
  });
});

describe("removeDirectory", () => {
  it("removes a directory from a workspace", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({
      name: "Test",
      directories: [{ deviceId: "host", remotePath: "/app", label: "app" }],
    });
    const dirId = ws.directories[0]!.id;
    const removed = await svc.removeDirectory(ws.id, dirId);
    expect(removed).toBe(true);
    const updated = await svc.get(ws.id);
    expect(updated!.directories).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

describe("bindAgent / unbindAgent", () => {
  it("binds and unbinds an agent", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({ name: "Test" });

    const bound = await svc.bindAgent(ws.id, "coder");
    expect(bound).toBe(true);

    const updated = await svc.get(ws.id);
    expect(updated!.bindings).toHaveLength(1);
    expect(updated!.bindings[0]!.agentId).toBe("coder");

    const unbound = await svc.unbindAgent(ws.id, "coder");
    expect(unbound).toBe(true);

    const after = await svc.get(ws.id);
    expect(after!.bindings).toHaveLength(0);
  });

  it("does not duplicate bindings", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({ name: "Test" });
    await svc.bindAgent(ws.id, "coder");
    await svc.bindAgent(ws.id, "coder");
    const updated = await svc.get(ws.id);
    expect(updated!.bindings).toHaveLength(1);
  });
});

describe("bindSession / unbindSession", () => {
  it("binds and unbinds a session", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({ name: "Test" });

    await svc.bindSession(ws.id, "session-123");
    const updated = await svc.get(ws.id);
    expect(updated!.bindings).toHaveLength(1);
    expect(updated!.bindings[0]!.sessionKey).toBe("session-123");

    await svc.unbindSession(ws.id, "session-123");
    const after = await svc.get(ws.id);
    expect(after!.bindings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe("resolveForSession", () => {
  it("resolves by session binding first", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws1 = await svc.create({ name: "Agent WS" });
    const ws2 = await svc.create({ name: "Session WS" });
    await svc.bindAgent(ws1.id, "coder");
    await svc.bindSession(ws2.id, "session-abc");

    const resolved = await svc.resolveForSession("session-abc", "coder");
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(ws2.id);
  });

  it("falls back to agent binding when no session match", async () => {
    const svc = new WorkspaceService(createDeps());
    const ws = await svc.create({ name: "Agent WS" });
    await svc.bindAgent(ws.id, "coder");

    const resolved = await svc.resolveForSession("other-session", "coder");
    expect(resolved).not.toBeNull();
    expect(resolved!.id).toBe(ws.id);
  });

  it("returns null when no binding matches", async () => {
    const svc = new WorkspaceService(createDeps());
    await svc.create({ name: "Unbound" });
    const resolved = await svc.resolveForSession("no-match");
    expect(resolved).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe("concurrent operations", () => {
  it("handles concurrent creates without data loss", async () => {
    const svc = new WorkspaceService(createDeps());
    const promises = Array.from({ length: 10 }, (_, i) => svc.create({ name: `Workspace ${i}` }));
    const results = await Promise.all(promises);
    expect(results).toHaveLength(10);

    const list = await svc.list();
    expect(list).toHaveLength(10);
  });
});

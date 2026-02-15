import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LauncherService, type LauncherServiceDeps } from "./service.js";
import { readLauncherStore } from "./store.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let storePath: string;
let events: Array<{ event: string; payload: unknown }>;
let logs: string[];

function makeDeps(overrides?: Partial<LauncherServiceDeps>): LauncherServiceDeps {
  return {
    storePath,
    log: {
      info: (msg) => logs.push(`INFO: ${msg}`),
      warn: (msg) => logs.push(`WARN: ${msg}`),
      error: (msg) => logs.push(`ERROR: ${msg}`),
    },
    broadcast: (event, payload) => {
      events.push({ event, payload });
    },
    nowMs: () => 1000,
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-launcher-svc-"));
  storePath = path.join(tmpDir, "store.json");
  events = [];
  logs = [];
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe("create", () => {
  it("creates an app with defaults", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "My App" });

    expect(app.name).toBe("My App");
    expect(app.description).toBe("");
    expect(app.category).toBe("custom");
    expect(app.status).toBe("stopped");
    expect(app.pinned).toBe(false);
    expect(app.createdAtMs).toBe(1000);
    expect(app.updatedAtMs).toBe(1000);
    expect(app.id).toBeTruthy();
  });

  it("creates an app with all fields", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({
      name: "VS Code",
      description: "Code editor",
      category: "native",
      icon: "vscode",
      app_path: "/Applications/Visual Studio Code.app",
      bundle_id: "com.microsoft.VSCode",
      pinned: true,
      pinned_order: 1,
      tags: ["dev"],
      color: "blue",
    });

    expect(app.name).toBe("VS Code");
    expect(app.description).toBe("Code editor");
    expect(app.category).toBe("native");
    expect(app.app_path).toBe("/Applications/Visual Studio Code.app");
    expect(app.bundle_id).toBe("com.microsoft.VSCode");
    expect(app.pinned).toBe(true);
    expect(app.pinned_order).toBe(1);
    expect(app.tags).toEqual(["dev"]);
    expect(app.color).toBe("blue");
  });

  it("persists to store", async () => {
    const svc = new LauncherService(makeDeps());
    await svc.create({ name: "Persisted App" });

    const store = await readLauncherStore(storePath);
    expect(store.apps).toHaveLength(1);
    expect(store.apps[0]!.name).toBe("Persisted App");
  });

  it("emits launcher.created event", async () => {
    const svc = new LauncherService(makeDeps());
    await svc.create({ name: "Event App" });

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("launcher.created");
  });
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe("update", () => {
  it("updates partial fields", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "Original" });

    const updated = await svc.update(app.id, { name: "Updated", description: "new desc" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated");
    expect(updated!.description).toBe("new desc");
    expect(updated!.updatedAtMs).toBe(1000);
  });

  it("returns null for unknown app", async () => {
    const svc = new LauncherService(makeDeps());
    const result = await svc.update("nonexistent", { name: "X" });
    expect(result).toBeNull();
  });

  it("emits launcher.updated event", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "A" });
    events = [];
    await svc.update(app.id, { name: "B" });

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("launcher.updated");
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

describe("delete", () => {
  it("removes app from store", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "To Delete" });

    const deleted = await svc.delete(app.id);
    expect(deleted).toBe(true);

    const store = await readLauncherStore(storePath);
    expect(store.apps).toHaveLength(0);
  });

  it("returns false for unknown app", async () => {
    const svc = new LauncherService(makeDeps());
    const deleted = await svc.delete("nonexistent");
    expect(deleted).toBe(false);
  });

  it("emits launcher.deleted event", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "A" });
    events = [];
    await svc.delete(app.id);

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("launcher.deleted");
    expect((events[0]!.payload as { appId: string }).appId).toBe(app.id);
  });
});

// ---------------------------------------------------------------------------
// List / Get
// ---------------------------------------------------------------------------

describe("list", () => {
  it("returns all apps without filter", async () => {
    const svc = new LauncherService(makeDeps());
    await svc.create({ name: "A", category: "native" });
    await svc.create({ name: "B", category: "custom" });

    const apps = await svc.list();
    expect(apps).toHaveLength(2);
  });

  it("filters by category", async () => {
    const svc = new LauncherService(makeDeps());
    await svc.create({ name: "A", category: "native" });
    await svc.create({ name: "B", category: "custom" });

    const apps = await svc.list({ category: "native" });
    expect(apps).toHaveLength(1);
    expect(apps[0]!.name).toBe("A");
  });

  it("filters by pinned", async () => {
    const svc = new LauncherService(makeDeps());
    await svc.create({ name: "A", pinned: true });
    await svc.create({ name: "B", pinned: false });

    const pinned = await svc.list({ pinned: true });
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.name).toBe("A");

    const unpinned = await svc.list({ pinned: false });
    expect(unpinned).toHaveLength(1);
    expect(unpinned[0]!.name).toBe("B");
  });

  it("respects limit", async () => {
    const svc = new LauncherService(makeDeps());
    await svc.create({ name: "A" });
    await svc.create({ name: "B" });
    await svc.create({ name: "C" });

    const apps = await svc.list({ limit: 2 });
    expect(apps).toHaveLength(2);
  });
});

describe("get", () => {
  it("returns app by ID", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "FindMe" });

    const found = await svc.get(app.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("FindMe");
  });

  it("returns null for unknown ID", async () => {
    const svc = new LauncherService(makeDeps());
    const found = await svc.get("nonexistent");
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pin / Unpin
// ---------------------------------------------------------------------------

describe("pin", () => {
  it("pins an app with order", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "A" });

    const pinned = await svc.pin(app.id, 3);
    expect(pinned).not.toBeNull();
    expect(pinned!.pinned).toBe(true);
    expect(pinned!.pinned_order).toBe(3);
  });

  it("emits launcher.pinned event", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "A" });
    events = [];
    await svc.pin(app.id, 1);

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("launcher.pinned");
  });

  it("returns null for unknown app", async () => {
    const svc = new LauncherService(makeDeps());
    const result = await svc.pin("nonexistent", 1);
    expect(result).toBeNull();
  });
});

describe("unpin", () => {
  it("unpins an app", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "A", pinned: true, pinned_order: 2 });

    const unpinned = await svc.unpin(app.id);
    expect(unpinned).not.toBeNull();
    expect(unpinned!.pinned).toBe(false);
    expect(unpinned!.pinned_order).toBe(0);
  });

  it("emits launcher.unpinned event", async () => {
    const svc = new LauncherService(makeDeps());
    const app = await svc.create({ name: "A", pinned: true });
    events = [];
    await svc.unpin(app.id);

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("launcher.unpinned");
  });
});

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

describe("reorder", () => {
  it("reorders pinned apps", async () => {
    const svc = new LauncherService(makeDeps());
    const a = await svc.create({ name: "A", pinned: true, pinned_order: 1 });
    const b = await svc.create({ name: "B", pinned: true, pinned_order: 2 });

    const updated = await svc.reorder([
      [a.id, 2],
      [b.id, 1],
    ]);

    expect(updated).toHaveLength(2);

    const store = await readLauncherStore(storePath);
    const appA = store.apps.find((x) => x.id === a.id);
    const appB = store.apps.find((x) => x.id === b.id);
    expect(appA!.pinned_order).toBe(2);
    expect(appB!.pinned_order).toBe(1);
  });

  it("emits launcher.reordered event", async () => {
    const svc = new LauncherService(makeDeps());
    const a = await svc.create({ name: "A" });
    events = [];
    await svc.reorder([[a.id, 5]]);

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("launcher.reordered");
  });
});

// ---------------------------------------------------------------------------
// Discovered apps
// ---------------------------------------------------------------------------

describe("discovered apps", () => {
  it("updates and retrieves discovered apps", async () => {
    const svc = new LauncherService(makeDeps());
    const discovered = [
      {
        name: "Safari",
        bundle_id: "com.apple.Safari",
        path: "/Applications/Safari.app",
        icon_path: null,
      },
      {
        name: "Chrome",
        bundle_id: "com.google.Chrome",
        path: "/Applications/Google Chrome.app",
        icon_path: null,
      },
    ];

    await svc.updateDiscoveredApps(discovered);
    const result = await svc.getDiscoveredApps();

    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("Safari");
    expect(result[1]!.name).toBe("Chrome");
  });

  it("emits launcher.discovered event", async () => {
    const svc = new LauncherService(makeDeps());
    events = [];
    await svc.updateDiscoveredApps([]);

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("launcher.discovered");
  });

  it("persists discovered apps to store", async () => {
    const svc = new LauncherService(makeDeps());
    await svc.updateDiscoveredApps([
      { name: "App", bundle_id: "com.test", path: "/test", icon_path: null },
    ]);

    const store = await readLauncherStore(storePath);
    expect(store.discoveredApps).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

describe("locking", () => {
  it("handles concurrent operations without corruption", async () => {
    const svc = new LauncherService(makeDeps());

    // Fire 10 creates concurrently
    const promises = Array.from({ length: 10 }, (_, i) => svc.create({ name: `App ${i}` }));
    await Promise.all(promises);

    const apps = await svc.list();
    expect(apps).toHaveLength(10);

    // All should have unique IDs
    const ids = new Set(apps.map((a) => a.id));
    expect(ids.size).toBe(10);
  });
});

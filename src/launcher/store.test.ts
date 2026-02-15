import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LauncherStoreFile } from "./types.js";
import {
  readLauncherStore,
  resolveLauncherStorePath,
  writeLauncherStore,
  migrateLegacyLauncherStore,
} from "./store.js";

async function makeTmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-launcher-store-"));
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

describe("resolveLauncherStorePath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns default path under ~/.openclaw/launcher/", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolveLauncherStorePath();
    expect(result).toBe(path.join("/home/testuser", ".openclaw", "launcher", "store.json"));
  });

  it("resolves custom path when provided", () => {
    const result = resolveLauncherStorePath("/custom/path/launcher.json");
    expect(result).toBe(path.resolve("/custom/path/launcher.json"));
  });
});

// ---------------------------------------------------------------------------
// Store read/write
// ---------------------------------------------------------------------------

describe("readLauncherStore", () => {
  it("returns empty store when file does not exist", async () => {
    const tmp = await makeTmpStore();
    const store = await readLauncherStore(tmp.storePath);
    expect(store).toEqual({ version: 1, apps: [], discoveredApps: [] });
    await tmp.cleanup();
  });

  it("reads valid store file", async () => {
    const tmp = await makeTmpStore();
    const data: LauncherStoreFile = {
      version: 1,
      apps: [
        {
          id: "a1",
          name: "Test App",
          description: "",
          category: "native",
          icon: "",
          icon_path: null,
          pinned: false,
          pinned_order: 0,
          status: "stopped",
          last_launched_at: null,
          bundle_id: "com.test.app",
          app_path: "/Applications/Test.app",
          run_command: null,
          working_dir: null,
          port: null,
          session_id: null,
          maestro_app_id: null,
          url: null,
          tags: [],
          color: null,
          createdAtMs: 1000,
          updatedAtMs: 1000,
        },
      ],
      discoveredApps: [],
    };
    await fs.mkdir(path.dirname(tmp.storePath), { recursive: true });
    await fs.writeFile(tmp.storePath, JSON.stringify(data), "utf-8");
    const store = await readLauncherStore(tmp.storePath);
    expect(store.version).toBe(1);
    expect(store.apps).toHaveLength(1);
    expect(store.apps[0]!.name).toBe("Test App");
    expect(store.discoveredApps).toEqual([]);
    await tmp.cleanup();
  });

  it("returns empty store when file contains invalid JSON", async () => {
    const tmp = await makeTmpStore();
    await fs.mkdir(path.dirname(tmp.storePath), { recursive: true });
    await fs.writeFile(tmp.storePath, "{ broken json", "utf-8");
    const store = await readLauncherStore(tmp.storePath);
    expect(store).toEqual({ version: 1, apps: [], discoveredApps: [] });
    await tmp.cleanup();
  });

  it("returns empty store when version is wrong", async () => {
    const tmp = await makeTmpStore();
    await fs.mkdir(path.dirname(tmp.storePath), { recursive: true });
    await fs.writeFile(
      tmp.storePath,
      JSON.stringify({ version: 99, apps: [], discoveredApps: [] }),
      "utf-8",
    );
    const store = await readLauncherStore(tmp.storePath);
    expect(store).toEqual({ version: 1, apps: [], discoveredApps: [] });
    await tmp.cleanup();
  });

  it("backfills discoveredApps when missing from file", async () => {
    const tmp = await makeTmpStore();
    await fs.mkdir(path.dirname(tmp.storePath), { recursive: true });
    await fs.writeFile(tmp.storePath, JSON.stringify({ version: 1, apps: [] }), "utf-8");
    const store = await readLauncherStore(tmp.storePath);
    expect(store.discoveredApps).toEqual([]);
    await tmp.cleanup();
  });
});

describe("writeLauncherStore", () => {
  it("writes store file atomically", async () => {
    const tmp = await makeTmpStore();
    const data: LauncherStoreFile = {
      version: 1,
      apps: [
        {
          id: "a1",
          name: "Written App",
          description: "desc",
          category: "custom",
          icon: "",
          icon_path: null,
          pinned: true,
          pinned_order: 1,
          status: "stopped",
          last_launched_at: null,
          bundle_id: null,
          app_path: null,
          run_command: null,
          working_dir: null,
          port: null,
          session_id: null,
          maestro_app_id: null,
          url: null,
          tags: [],
          color: null,
          createdAtMs: 2000,
          updatedAtMs: 2000,
        },
      ],
      discoveredApps: [],
    };
    await writeLauncherStore(tmp.storePath, data);
    const raw = await fs.readFile(tmp.storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.apps).toHaveLength(1);
    expect(parsed.apps[0].name).toBe("Written App");
    await tmp.cleanup();
  });

  it("creates parent directories if they don't exist", async () => {
    const tmp = await makeTmpStore();
    const deep = path.join(tmp.dir, "a", "b", "c", "store.json");
    await writeLauncherStore(deep, { version: 1, apps: [], discoveredApps: [] });
    const raw = await fs.readFile(deep, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, apps: [], discoveredApps: [] });
    await tmp.cleanup();
  });

  it("no .tmp file left behind after write", async () => {
    const tmp = await makeTmpStore();
    await writeLauncherStore(tmp.storePath, { version: 1, apps: [], discoveredApps: [] });
    const files = await fs.readdir(path.dirname(tmp.storePath));
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Empty store factory isolation
// ---------------------------------------------------------------------------

describe("emptyStore factory", () => {
  it("returns distinct arrays to prevent shared-reference bugs", async () => {
    const tmp = await makeTmpStore();
    const store1 = await readLauncherStore(tmp.storePath);
    const store2 = await readLauncherStore(tmp.storePath);
    expect(store1.apps).not.toBe(store2.apps);
    expect(store1.discoveredApps).not.toBe(store2.discoveredApps);
    await tmp.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

describe("migrateLegacyLauncherStore", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("migrates legacy ~/.maestro-launcher.json to new store", async () => {
    const tmp = await makeTmpStore();
    const homeDir = tmp.dir;
    vi.stubEnv("HOME", homeDir);

    // Create legacy file
    const legacyPath = path.join(homeDir, ".maestro-launcher.json");
    const legacyApps = [
      {
        id: "native-com.apple.Safari",
        name: "Safari",
        category: "native",
        icon: "",
        icon_path: null,
        pinned: true,
        pinned_order: 1,
        status: "stopped",
        last_launched_at: null,
        bundle_id: "com.apple.Safari",
        app_path: "/Applications/Safari.app",
        run_command: null,
        working_dir: null,
        port: null,
        session_id: null,
        maestro_app_id: null,
        url: null,
        tags: [],
        color: null,
      },
    ];
    await fs.writeFile(legacyPath, JSON.stringify(legacyApps), "utf-8");

    const migrated = await migrateLegacyLauncherStore(tmp.storePath, 5000);
    expect(migrated).toBe(true);

    const store = await readLauncherStore(tmp.storePath);
    expect(store.apps).toHaveLength(1);
    expect(store.apps[0]!.name).toBe("Safari");
    expect(store.apps[0]!.description).toBe("");
    expect(store.apps[0]!.createdAtMs).toBe(5000);
    expect(store.apps[0]!.updatedAtMs).toBe(5000);
    await tmp.cleanup();
  });

  it("skips migration when new store already exists", async () => {
    const tmp = await makeTmpStore();
    await writeLauncherStore(tmp.storePath, { version: 1, apps: [], discoveredApps: [] });

    const migrated = await migrateLegacyLauncherStore(tmp.storePath);
    expect(migrated).toBe(false);
    await tmp.cleanup();
  });

  it("skips migration when no legacy file exists", async () => {
    const tmp = await makeTmpStore();
    vi.stubEnv("HOME", tmp.dir);

    const migrated = await migrateLegacyLauncherStore(tmp.storePath);
    expect(migrated).toBe(false);
    await tmp.cleanup();
  });
});

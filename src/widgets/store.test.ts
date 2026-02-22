import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  WidgetRegistryFile,
  WidgetInstancesFile,
  DataSourcesFile,
  WidgetDefinition,
  WidgetInstance,
  DataSource,
} from "./types.js";
import {
  resolveWidgetStorePath,
  ensureDir,
  emptyRegistry,
  emptyInstances,
  emptyDataSources,
  readWidgetRegistry,
  writeWidgetRegistry,
  readWidgetInstances,
  writeWidgetInstances,
  readDataSources,
  writeDataSources,
} from "./store.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "widget-store-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("resolveWidgetStorePath", () => {
  it("returns custom path when provided", () => {
    const result = resolveWidgetStorePath("/custom/widgets");
    expect(result).toBe(path.resolve("/custom/widgets"));
  });

  it("returns default path under HOME/.openclaw/widgets when no custom path given", () => {
    vi.stubEnv("HOME", "/home/testuser");
    const result = resolveWidgetStorePath();
    expect(result).toBe(path.join("/home/testuser", ".openclaw", "widgets"));
  });
});

// ---------------------------------------------------------------------------
// ensureDir
// ---------------------------------------------------------------------------

describe("ensureDir", () => {
  it("creates directory recursively if it does not exist", async () => {
    const deepDir = path.join(tmpDir, "a", "b", "c");
    await ensureDir(deepDir);
    const stat = await fs.stat(deepDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("does not throw if directory already exists", async () => {
    await ensureDir(tmpDir);
    // No error means success
    const stat = await fs.stat(tmpDir);
    expect(stat.isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Empty factory functions
// ---------------------------------------------------------------------------

describe("empty factory functions", () => {
  it("emptyRegistry returns a new object each call", () => {
    const a = emptyRegistry();
    const b = emptyRegistry();
    expect(a).toEqual({ definitions: [] });
    expect(a).not.toBe(b);
    // Mutating one does not affect the other
    a.definitions.push({} as WidgetDefinition);
    expect(b.definitions).toHaveLength(0);
  });

  it("emptyInstances returns a new object each call", () => {
    const a = emptyInstances();
    const b = emptyInstances();
    expect(a).toEqual({ instances: [] });
    expect(a).not.toBe(b);
  });

  it("emptyDataSources returns a new object each call", () => {
    const a = emptyDataSources();
    const b = emptyDataSources();
    expect(a).toEqual({ sources: [] });
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Widget Registry – registry.json
// ---------------------------------------------------------------------------

describe("Widget Registry (registry.json)", () => {
  it("returns empty registry when file does not exist", async () => {
    const filePath = path.join(tmpDir, "registry.json");
    const result = await readWidgetRegistry(filePath);
    expect(result).toEqual({ definitions: [] });
  });

  it("round-trips registry data", async () => {
    const filePath = path.join(tmpDir, "registry.json");
    const def: WidgetDefinition = {
      id: "def-1",
      type: "tasks",
      name: "Task Widget",
      category: "system",
      size: { minW: 200, maxW: 400, minH: 100, maxH: 300, defaultW: 300, defaultH: 200 },
      createdBy: "system",
      createdAt: Date.now(),
      persistent: true,
    };
    const data: WidgetRegistryFile = { definitions: [def] };

    await writeWidgetRegistry(filePath, data);
    const result = await readWidgetRegistry(filePath);

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]!.id).toBe("def-1");
    expect(result.definitions[0]!.name).toBe("Task Widget");
  });

  it("returns empty registry when definitions is not an array", async () => {
    const filePath = path.join(tmpDir, "registry.json");
    await fs.writeFile(filePath, JSON.stringify({ definitions: "bad" }), "utf-8");
    const result = await readWidgetRegistry(filePath);
    expect(result).toEqual({ definitions: [] });
  });

  it("returns empty registry on invalid JSON", async () => {
    const filePath = path.join(tmpDir, "registry.json");
    await fs.writeFile(filePath, "{ broken json", "utf-8");
    const result = await readWidgetRegistry(filePath);
    expect(result).toEqual({ definitions: [] });
  });
});

// ---------------------------------------------------------------------------
// Widget Instances – instances.json
// ---------------------------------------------------------------------------

describe("Widget Instances (instances.json)", () => {
  it("returns empty instances when file does not exist", async () => {
    const filePath = path.join(tmpDir, "instances.json");
    const result = await readWidgetInstances(filePath);
    expect(result).toEqual({ instances: [] });
  });

  it("round-trips instance data", async () => {
    const filePath = path.join(tmpDir, "instances.json");
    const inst: WidgetInstance = {
      id: "inst-1",
      definitionId: "def-1",
      position: { x: 10, y: 20 },
      dimensions: { w: 300, h: 200 },
      pinned: false,
      minimized: false,
      createdAt: Date.now(),
    };
    const data: WidgetInstancesFile = { instances: [inst] };

    await writeWidgetInstances(filePath, data);
    const result = await readWidgetInstances(filePath);

    expect(result.instances).toHaveLength(1);
    expect(result.instances[0]!.id).toBe("inst-1");
    expect(result.instances[0]!.position).toEqual({ x: 10, y: 20 });
  });

  it("returns empty instances when instances is not an array", async () => {
    const filePath = path.join(tmpDir, "instances.json");
    await fs.writeFile(filePath, JSON.stringify({ instances: 42 }), "utf-8");
    const result = await readWidgetInstances(filePath);
    expect(result).toEqual({ instances: [] });
  });
});

// ---------------------------------------------------------------------------
// Data Sources – data-sources.json
// ---------------------------------------------------------------------------

describe("Data Sources (data-sources.json)", () => {
  it("returns empty data sources when file does not exist", async () => {
    const filePath = path.join(tmpDir, "data-sources.json");
    const result = await readDataSources(filePath);
    expect(result).toEqual({ sources: [] });
  });

  it("round-trips data source data", async () => {
    const filePath = path.join(tmpDir, "data-sources.json");
    const src: DataSource = {
      id: "ds-1",
      name: "CPU Monitor",
      lastUpdated: Date.now(),
      createdBy: "system",
    };
    const data: DataSourcesFile = { sources: [src] };

    await writeDataSources(filePath, data);
    const result = await readDataSources(filePath);

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.id).toBe("ds-1");
    expect(result.sources[0]!.name).toBe("CPU Monitor");
  });

  it("returns empty data sources when sources is not an array", async () => {
    const filePath = path.join(tmpDir, "data-sources.json");
    await fs.writeFile(filePath, JSON.stringify({ sources: null }), "utf-8");
    const result = await readDataSources(filePath);
    expect(result).toEqual({ sources: [] });
  });
});

// ---------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------

describe("Atomic writes", () => {
  it("leaves no .tmp file behind after write", async () => {
    const filePath = path.join(tmpDir, "registry.json");
    await writeWidgetRegistry(filePath, { definitions: [] });
    const files = await fs.readdir(tmpDir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
  });

  it("creates parent directories if they do not exist", async () => {
    const deepPath = path.join(tmpDir, "a", "b", "c", "registry.json");
    await writeWidgetRegistry(deepPath, { definitions: [] });
    const raw = await fs.readFile(deepPath, "utf-8");
    expect(JSON.parse(raw)).toEqual({ definitions: [] });
  });
});

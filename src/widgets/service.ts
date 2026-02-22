// ---------------------------------------------------------------------------
// WidgetService – Core widget management service
// ---------------------------------------------------------------------------
// Follows the TaskService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type {
  WidgetDefinition,
  WidgetDefinitionCreateInput,
  WidgetDefinitionFilter,
  WidgetInstance,
  WidgetInstanceCreateInput,
  WidgetInstanceFilter,
  WidgetInstancePatch,
  WidgetCategory,
  WidgetType,
  DataSource,
  DataSourceCreateInput,
} from "./types.js";
import {
  readWidgetRegistry,
  writeWidgetRegistry,
  readWidgetInstances,
  writeWidgetInstances,
  readDataSources,
  writeDataSources,
} from "./store.js";
import { DEFAULT_WIDGET_SIZES } from "./types.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type WidgetServiceDeps = {
  storePath: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
  nowMs?: () => number;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type WidgetServiceState = {
  deps: WidgetServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: WidgetServiceDeps): WidgetServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as TaskService)
// ---------------------------------------------------------------------------

const storeLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: WidgetServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// WidgetService
// ---------------------------------------------------------------------------

export class WidgetService {
  private readonly state: WidgetServiceState;

  constructor(deps: WidgetServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  /** Resolve file path inside the store directory */
  private file(name: string): string {
    return path.join(this.state.deps.storePath, name);
  }

  // =========================================================================
  // Registry (definitions)
  // =========================================================================

  async createDefinition(input: WidgetDefinitionCreateInput): Promise<WidgetDefinition> {
    return locked(this.state, async () => {
      const registry = await readWidgetRegistry(this.file("registry.json"));
      const now = this.now();

      const defaults = DEFAULT_WIDGET_SIZES[input.type];
      const size = { ...defaults, ...input.size };

      const def: WidgetDefinition = {
        id: randomUUID(),
        type: input.type,
        name: input.name,
        description: input.description,
        category: input.category ?? "custom",
        size,
        schema: input.schema,
        dataSource: input.dataSource,
        createdBy: input.createdBy ?? "user",
        createdAt: now,
        persistent: input.persistent ?? false,
      };

      registry.definitions.push(def);
      await writeWidgetRegistry(this.file("registry.json"), registry);

      this.emit("widget.definition.created", def);
      this.state.deps.log.info(`widget definition created: ${def.id} — ${def.name}`);

      return def;
    });
  }

  async listDefinitions(filter?: WidgetDefinitionFilter): Promise<WidgetDefinition[]> {
    const registry = await readWidgetRegistry(this.file("registry.json"));
    let defs = registry.definitions;

    if (filter) {
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        const typeSet = new Set<WidgetType>(types);
        defs = defs.filter((d) => typeSet.has(d.type));
      }
      if (filter.category) {
        const cats = Array.isArray(filter.category) ? filter.category : [filter.category];
        const catSet = new Set<WidgetCategory>(cats);
        defs = defs.filter((d) => catSet.has(d.category));
      }
      if (filter.createdBy) {
        defs = defs.filter((d) => d.createdBy === filter.createdBy);
      }
      if (filter.persistent !== undefined) {
        defs = defs.filter((d) => d.persistent === filter.persistent);
      }
      if (filter.limit && filter.limit > 0) {
        defs = defs.slice(0, filter.limit);
      }
    }

    return defs;
  }

  async getDefinition(id: string): Promise<WidgetDefinition | null> {
    const registry = await readWidgetRegistry(this.file("registry.json"));
    return registry.definitions.find((d) => d.id === id) ?? null;
  }

  async deleteDefinition(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const registry = await readWidgetRegistry(this.file("registry.json"));
      const idx = registry.definitions.findIndex((d) => d.id === id);
      if (idx === -1) {
        return false;
      }

      const def = registry.definitions[idx]!;
      if (def.createdBy === "system") {
        this.state.deps.log.warn(`cannot delete system definition: ${id}`);
        return false;
      }

      registry.definitions.splice(idx, 1);
      await writeWidgetRegistry(this.file("registry.json"), registry);

      this.emit("widget.definition.deleted", { id });
      this.state.deps.log.info(`widget definition deleted: ${id}`);
      return true;
    });
  }

  // =========================================================================
  // Instances
  // =========================================================================

  async spawnInstance(input: WidgetInstanceCreateInput): Promise<WidgetInstance> {
    return locked(this.state, async () => {
      // Validate definitionId exists
      const registry = await readWidgetRegistry(this.file("registry.json"));
      const def = registry.definitions.find((d) => d.id === input.definitionId);
      if (!def) {
        throw new Error(`definition not found: ${input.definitionId}`);
      }

      const instances = await readWidgetInstances(this.file("instances.json"));
      const now = this.now();

      const instance: WidgetInstance = {
        id: randomUUID(),
        definitionId: input.definitionId,
        position: input.position ?? { x: 0, y: 0 },
        dimensions: input.dimensions ?? { w: def.size.defaultW, h: def.size.defaultH },
        pinned: input.pinned ?? false,
        minimized: input.minimized ?? false,
        data: input.data,
        config: input.config,
        spawnedBy: input.spawnedBy,
        deviceId: input.deviceId,
        createdAt: now,
      };

      instances.instances.push(instance);
      await writeWidgetInstances(this.file("instances.json"), instances);

      this.emit("widget.instance.spawned", instance);
      this.state.deps.log.info(`widget instance spawned: ${instance.id} (def: ${def.name})`);

      return instance;
    });
  }

  async dismissInstance(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const instances = await readWidgetInstances(this.file("instances.json"));
      const idx = instances.instances.findIndex((i) => i.id === id);
      if (idx === -1) {
        return false;
      }

      instances.instances.splice(idx, 1);
      await writeWidgetInstances(this.file("instances.json"), instances);

      this.emit("widget.instance.dismissed", { id });
      this.state.deps.log.info(`widget instance dismissed: ${id}`);
      return true;
    });
  }

  async listInstances(filter?: WidgetInstanceFilter): Promise<WidgetInstance[]> {
    const instances = await readWidgetInstances(this.file("instances.json"));
    let list = instances.instances;

    if (filter) {
      if (filter.definitionId) {
        list = list.filter((i) => i.definitionId === filter.definitionId);
      }
      if (filter.deviceId) {
        list = list.filter((i) => i.deviceId === filter.deviceId);
      }
      if (filter.spawnedBy) {
        list = list.filter((i) => i.spawnedBy === filter.spawnedBy);
      }
      if (filter.pinned !== undefined) {
        list = list.filter((i) => i.pinned === filter.pinned);
      }
      if (filter.limit && filter.limit > 0) {
        list = list.slice(0, filter.limit);
      }
    }

    return list;
  }

  async updateInstance(id: string, patch: WidgetInstancePatch): Promise<WidgetInstance | null> {
    return locked(this.state, async () => {
      const instances = await readWidgetInstances(this.file("instances.json"));
      const idx = instances.instances.findIndex((i) => i.id === id);
      if (idx === -1) {
        return null;
      }

      const instance = instances.instances[idx]!;

      if (patch.position !== undefined) {
        instance.position = patch.position;
      }
      if (patch.dimensions !== undefined) {
        instance.dimensions = patch.dimensions;
      }
      if (patch.pinned !== undefined) {
        instance.pinned = patch.pinned;
      }
      if (patch.minimized !== undefined) {
        instance.minimized = patch.minimized;
      }
      if (patch.data !== undefined) {
        instance.data = { ...instance.data, ...patch.data };
      }
      if (patch.config !== undefined) {
        instance.config = { ...instance.config, ...patch.config };
      }

      instances.instances[idx] = instance;
      await writeWidgetInstances(this.file("instances.json"), instances);

      this.emit("widget.instance.updated", instance);
      return instance;
    });
  }

  async pushData(instanceId: string, data: Record<string, unknown>): Promise<boolean> {
    return locked(this.state, async () => {
      const instances = await readWidgetInstances(this.file("instances.json"));
      const idx = instances.instances.findIndex((i) => i.id === instanceId);
      if (idx === -1) {
        return false;
      }

      const instance = instances.instances[idx]!;
      instance.data = { ...instance.data, ...data };
      instances.instances[idx] = instance;
      await writeWidgetInstances(this.file("instances.json"), instances);

      this.emit("widget.data.pushed", { instanceId, data });
      return true;
    });
  }

  // =========================================================================
  // Data Sources
  // =========================================================================

  async createDataSource(input: DataSourceCreateInput): Promise<DataSource> {
    return locked(this.state, async () => {
      const file = await readDataSources(this.file("data-sources.json"));

      const source: DataSource = {
        id: randomUUID(),
        name: input.name,
        schema: input.schema,
        ttl: input.ttl,
        createdBy: input.createdBy ?? "user",
      };

      file.sources.push(source);
      await writeDataSources(this.file("data-sources.json"), file);

      this.emit("widget.stream.created", source);
      this.state.deps.log.info(`data source created: ${source.id} — ${source.name}`);

      return source;
    });
  }

  async pushToStream(streamId: string, value: unknown): Promise<boolean> {
    return locked(this.state, async () => {
      const file = await readDataSources(this.file("data-sources.json"));
      const idx = file.sources.findIndex((s) => s.id === streamId);
      if (idx === -1) {
        return false;
      }

      const source = file.sources[idx]!;
      source.lastValue = value as Record<string, unknown>;
      source.lastUpdated = this.now();
      file.sources[idx] = source;
      await writeDataSources(this.file("data-sources.json"), file);

      this.emit("widget.stream.pushed", { streamId, value });
      return true;
    });
  }

  async listDataSources(): Promise<DataSource[]> {
    const file = await readDataSources(this.file("data-sources.json"));
    return file.sources;
  }

  async getDataSource(id: string): Promise<DataSource | null> {
    const file = await readDataSources(this.file("data-sources.json"));
    return file.sources.find((s) => s.id === id) ?? null;
  }

  async deleteDataSource(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const file = await readDataSources(this.file("data-sources.json"));
      const idx = file.sources.findIndex((s) => s.id === id);
      if (idx === -1) {
        return false;
      }

      file.sources.splice(idx, 1);
      await writeDataSources(this.file("data-sources.json"), file);

      this.emit("widget.stream.deleted", { id });
      this.state.deps.log.info(`data source deleted: ${id}`);
      return true;
    });
  }
}

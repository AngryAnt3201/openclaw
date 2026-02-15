// ---------------------------------------------------------------------------
// LauncherService – Core launcher management service
// ---------------------------------------------------------------------------
// Follows the TaskService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  LaunchableApp,
  LaunchableAppCreateInput,
  LaunchableAppPatch,
  LauncherFilter,
  DiscoveredApp,
} from "./types.js";
import { readLauncherStore, writeLauncherStore } from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type LauncherServiceDeps = {
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

type LauncherServiceState = {
  deps: LauncherServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: LauncherServiceDeps): LauncherServiceState {
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

async function locked<T>(state: LauncherServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// LauncherService
// ---------------------------------------------------------------------------

export class LauncherService {
  private readonly state: LauncherServiceState;

  constructor(deps: LauncherServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(input: LaunchableAppCreateInput): Promise<LaunchableApp> {
    return locked(this.state, async () => {
      const store = await readLauncherStore(this.state.deps.storePath);
      const now = this.now();

      const app: LaunchableApp = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? "",
        category: input.category ?? "custom",
        icon: input.icon ?? "",
        icon_path: input.icon_path ?? null,
        pinned: input.pinned ?? false,
        pinned_order: input.pinned_order ?? 0,
        status: "stopped",
        last_launched_at: null,

        bundle_id: input.bundle_id ?? null,
        app_path: input.app_path ?? null,
        run_command: input.run_command ?? null,
        working_dir: input.working_dir ?? null,
        port: input.port ?? null,
        session_id: null,
        maestro_app_id: input.maestro_app_id ?? null,
        url: input.url ?? null,

        tags: input.tags ?? [],
        color: input.color ?? null,

        createdAtMs: now,
        updatedAtMs: now,
      };

      store.apps.push(app);
      await writeLauncherStore(this.state.deps.storePath, store);

      this.emit("launcher.created", app);
      this.state.deps.log.info(`launcher app created: ${app.id} — ${app.name}`);

      return app;
    });
  }

  // -------------------------------------------------------------------------
  // update (partial patch)
  // -------------------------------------------------------------------------

  async update(appId: string, patch: LaunchableAppPatch): Promise<LaunchableApp | null> {
    return locked(this.state, async () => {
      const store = await readLauncherStore(this.state.deps.storePath);
      const idx = store.apps.findIndex((a) => a.id === appId);
      if (idx === -1) {
        return null;
      }

      const app = store.apps[idx]!;

      if (patch.name !== undefined) {
        app.name = patch.name;
      }
      if (patch.description !== undefined) {
        app.description = patch.description;
      }
      if (patch.category !== undefined) {
        app.category = patch.category;
      }
      if (patch.icon !== undefined) {
        app.icon = patch.icon;
      }
      if (patch.icon_path !== undefined) {
        app.icon_path = patch.icon_path;
      }
      if (patch.pinned !== undefined) {
        app.pinned = patch.pinned;
      }
      if (patch.pinned_order !== undefined) {
        app.pinned_order = patch.pinned_order;
      }
      if (patch.status !== undefined) {
        app.status = patch.status;
      }
      if (patch.last_launched_at !== undefined) {
        app.last_launched_at = patch.last_launched_at;
      }
      if (patch.bundle_id !== undefined) {
        app.bundle_id = patch.bundle_id;
      }
      if (patch.app_path !== undefined) {
        app.app_path = patch.app_path;
      }
      if (patch.run_command !== undefined) {
        app.run_command = patch.run_command;
      }
      if (patch.working_dir !== undefined) {
        app.working_dir = patch.working_dir;
      }
      if (patch.port !== undefined) {
        app.port = patch.port;
      }
      if (patch.maestro_app_id !== undefined) {
        app.maestro_app_id = patch.maestro_app_id;
      }
      if (patch.url !== undefined) {
        app.url = patch.url;
      }
      if (patch.tags !== undefined) {
        app.tags = patch.tags;
      }
      if (patch.color !== undefined) {
        app.color = patch.color;
      }
      app.updatedAtMs = this.now();

      store.apps[idx] = app;
      await writeLauncherStore(this.state.deps.storePath, store);

      this.emit("launcher.updated", app);
      return app;
    });
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(appId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readLauncherStore(this.state.deps.storePath);
      const idx = store.apps.findIndex((a) => a.id === appId);
      if (idx === -1) {
        return false;
      }

      store.apps.splice(idx, 1);
      await writeLauncherStore(this.state.deps.storePath, store);

      this.emit("launcher.deleted", { appId });
      this.state.deps.log.info(`launcher app deleted: ${appId}`);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // list / get
  // -------------------------------------------------------------------------

  async list(filter?: LauncherFilter): Promise<LaunchableApp[]> {
    const store = await readLauncherStore(this.state.deps.storePath);
    let apps = store.apps;

    if (filter) {
      if (filter.category) {
        apps = apps.filter((a) => a.category === filter.category);
      }
      if (filter.pinned !== undefined) {
        apps = apps.filter((a) => a.pinned === filter.pinned);
      }
      if (filter.limit && filter.limit > 0) {
        apps = apps.slice(0, filter.limit);
      }
    }

    return apps;
  }

  async get(appId: string): Promise<LaunchableApp | null> {
    const store = await readLauncherStore(this.state.deps.storePath);
    return store.apps.find((a) => a.id === appId) ?? null;
  }

  // -------------------------------------------------------------------------
  // pin / unpin
  // -------------------------------------------------------------------------

  async pin(appId: string, order: number): Promise<LaunchableApp | null> {
    return locked(this.state, async () => {
      const store = await readLauncherStore(this.state.deps.storePath);
      const idx = store.apps.findIndex((a) => a.id === appId);
      if (idx === -1) {
        return null;
      }

      const app = store.apps[idx]!;
      app.pinned = true;
      app.pinned_order = order;
      app.updatedAtMs = this.now();
      store.apps[idx] = app;
      await writeLauncherStore(this.state.deps.storePath, store);

      this.emit("launcher.pinned", app);
      return app;
    });
  }

  async unpin(appId: string): Promise<LaunchableApp | null> {
    return locked(this.state, async () => {
      const store = await readLauncherStore(this.state.deps.storePath);
      const idx = store.apps.findIndex((a) => a.id === appId);
      if (idx === -1) {
        return null;
      }

      const app = store.apps[idx]!;
      app.pinned = false;
      app.pinned_order = 0;
      app.updatedAtMs = this.now();
      store.apps[idx] = app;
      await writeLauncherStore(this.state.deps.storePath, store);

      this.emit("launcher.unpinned", app);
      return app;
    });
  }

  // -------------------------------------------------------------------------
  // reorder
  // -------------------------------------------------------------------------

  async reorder(orders: [string, number][]): Promise<LaunchableApp[]> {
    return locked(this.state, async () => {
      const store = await readLauncherStore(this.state.deps.storePath);
      const orderMap = new Map(orders);
      const now = this.now();
      const updated: LaunchableApp[] = [];

      for (const app of store.apps) {
        const newOrder = orderMap.get(app.id);
        if (newOrder !== undefined) {
          app.pinned_order = newOrder;
          app.updatedAtMs = now;
          updated.push(app);
        }
      }

      await writeLauncherStore(this.state.deps.storePath, store);

      this.emit("launcher.reordered", { orders, apps: updated });
      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // discovered apps
  // -------------------------------------------------------------------------

  async updateDiscoveredApps(apps: DiscoveredApp[]): Promise<void> {
    return locked(this.state, async () => {
      const store = await readLauncherStore(this.state.deps.storePath);
      store.discoveredApps = apps;
      await writeLauncherStore(this.state.deps.storePath, store);

      this.emit("launcher.discovered", { apps });
      this.state.deps.log.info(`discovered apps updated: ${apps.length} app(s)`);
    });
  }

  async getDiscoveredApps(): Promise<DiscoveredApp[]> {
    const store = await readLauncherStore(this.state.deps.storePath);
    return store.discoveredApps;
  }
}

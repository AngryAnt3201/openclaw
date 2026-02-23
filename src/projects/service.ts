// ---------------------------------------------------------------------------
// ProjectService – Core project management service
// ---------------------------------------------------------------------------
// Follows the WidgetService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  Project,
  ProjectCreateInput,
  ProjectFilter,
  ProjectPatch,
} from "./types.js";
import { readProjectStore, writeProjectStore } from "./store.js";

// ---------------------------------------------------------------------------
// Color presets (cycled through on create)
// ---------------------------------------------------------------------------

const COLOR_PRESETS = [
  "#4F8CFF", // blue
  "#7C5CFC", // purple
  "#FF6B6B", // red
  "#FFB347", // orange
  "#4ECB71", // green
  "#36CFC9", // teal
  "#F759AB", // pink
  "#FADB14", // yellow
] as const;

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type ProjectServiceDeps = {
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

type ProjectServiceState = {
  deps: ProjectServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: ProjectServiceDeps): ProjectServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as WidgetService / TaskService)
// ---------------------------------------------------------------------------

const storeLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: ProjectServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// ProjectService
// ---------------------------------------------------------------------------

export class ProjectService {
  private readonly state: ProjectServiceState;

  constructor(deps: ProjectServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  // =========================================================================
  // CRUD
  // =========================================================================

  async create(input: ProjectCreateInput): Promise<Project> {
    return locked(this.state, async () => {
      const store = await readProjectStore(this.state.deps.storePath);
      const now = this.now();

      // Cycle through color presets based on existing project count
      const colorIndex = store.projects.length % COLOR_PRESETS.length;

      const project: Project = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? "",
        color: input.color ?? COLOR_PRESETS[colorIndex]!,
        icon: input.icon ?? "\uD83D\uDCC1",
        status: "active",
        createdAtMs: now,
        updatedAtMs: now,
      };

      store.projects.push(project);
      await writeProjectStore(this.state.deps.storePath, store);

      this.emit("project.created", project);
      this.state.deps.log.info(`project created: ${project.id} — ${project.name}`);

      return project;
    });
  }

  async update(projectId: string, patch: ProjectPatch): Promise<Project | null> {
    return locked(this.state, async () => {
      const store = await readProjectStore(this.state.deps.storePath);
      const idx = store.projects.findIndex((p) => p.id === projectId);
      if (idx === -1) {
        return null;
      }

      const project = store.projects[idx]!;

      if (patch.name !== undefined) {
        project.name = patch.name;
      }
      if (patch.description !== undefined) {
        project.description = patch.description;
      }
      if (patch.color !== undefined) {
        project.color = patch.color;
      }
      if (patch.icon !== undefined) {
        project.icon = patch.icon;
      }
      if (patch.status !== undefined) {
        project.status = patch.status;
      }

      project.updatedAtMs = this.now();
      store.projects[idx] = project;
      await writeProjectStore(this.state.deps.storePath, store);

      this.emit("project.updated", project);
      this.state.deps.log.info(`project updated: ${project.id} — ${project.name}`);

      return project;
    });
  }

  async get(projectId: string): Promise<Project | null> {
    const store = await readProjectStore(this.state.deps.storePath);
    return store.projects.find((p) => p.id === projectId) ?? null;
  }

  async list(filter?: ProjectFilter): Promise<Project[]> {
    const store = await readProjectStore(this.state.deps.storePath);
    let projects = store.projects;

    if (filter) {
      if (filter.status) {
        projects = projects.filter((p) => p.status === filter.status);
      }
    }

    return projects;
  }

  async archive(projectId: string): Promise<Project | null> {
    return this.update(projectId, { status: "archived" });
  }

  async delete(projectId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readProjectStore(this.state.deps.storePath);
      const idx = store.projects.findIndex((p) => p.id === projectId);
      if (idx === -1) {
        return false;
      }

      store.projects.splice(idx, 1);
      await writeProjectStore(this.state.deps.storePath, store);

      this.emit("project.deleted", { id: projectId });
      this.state.deps.log.info(`project deleted: ${projectId}`);
      return true;
    });
  }
}

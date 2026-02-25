// ---------------------------------------------------------------------------
// PipelineService -- CRUD + lifecycle management for pipelines
// ---------------------------------------------------------------------------
// Follows the TaskService pattern: dependency-injected,
// event-driven, file-backed, with promise-based locking for safe concurrent
// access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  Pipeline,
  PipelineCreate,
  PipelineEvent,
  PipelineEventType,
  PipelinePatch,
} from "./types.js";
import { loadPipelineStore, savePipelineStore, appendPipelineEvent } from "./store.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface PipelineServiceOpts {
  storePath: string;
  onEvent?: (event: PipelineEvent) => void;
  nowMs?: () => number;
}

// ---------------------------------------------------------------------------
// Promise-based serialised lock
// ---------------------------------------------------------------------------

type ServiceState = {
  opts: PipelineServiceOpts;
  op: Promise<unknown>;
};

const storeLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: ServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.opts.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// PipelineService
// ---------------------------------------------------------------------------

export class PipelineService {
  private readonly state: ServiceState;

  constructor(opts: PipelineServiceOpts) {
    this.state = { opts, op: Promise.resolve() };
  }

  private now(): number {
    return this.state.opts.nowMs?.() ?? Date.now();
  }

  private makeEvent(
    pipelineId: string,
    type: PipelineEventType,
    message: string,
    data?: Record<string, unknown>,
  ): PipelineEvent {
    return {
      id: randomUUID(),
      pipelineId,
      type,
      timestamp: this.now(),
      message,
      data,
    };
  }

  private emitEvent(event: PipelineEvent): void {
    this.state.opts.onEvent?.(event);
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  async list(): Promise<Pipeline[]> {
    const store = await loadPipelineStore(this.state.opts.storePath);
    return store.pipelines;
  }

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  async get(id: string): Promise<Pipeline | null> {
    const store = await loadPipelineStore(this.state.opts.storePath);
    return store.pipelines.find((p) => p.id === id) ?? null;
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(input: PipelineCreate): Promise<Pipeline> {
    return locked(this.state, async () => {
      const store = await loadPipelineStore(this.state.opts.storePath);
      const now = this.now();

      const pipeline: Pipeline = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? "",
        enabled: input.enabled ?? false,
        nodes: input.nodes ?? [],
        edges: input.edges ?? [],
        status: "draft",
        viewport: input.viewport ?? { x: 0, y: 0, zoom: 1 },
        createdAtMs: now,
        updatedAtMs: now,
        runCount: 0,
      };

      store.pipelines.push(pipeline);
      await savePipelineStore(this.state.opts.storePath, store);

      const event = this.makeEvent(
        pipeline.id,
        "pipeline_created",
        `Pipeline created: ${pipeline.name}`,
      );
      await appendPipelineEvent(this.state.opts.storePath, event);
      this.emitEvent(event);

      return pipeline;
    });
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  async update(id: string, patch: PipelinePatch): Promise<Pipeline> {
    return locked(this.state, async () => {
      const store = await loadPipelineStore(this.state.opts.storePath);
      const idx = store.pipelines.findIndex((p) => p.id === id);
      if (idx === -1) {
        throw new Error(`Pipeline not found: ${id}`);
      }

      const pipeline = store.pipelines[idx]!;

      if (patch.name !== undefined) {
        pipeline.name = patch.name;
      }
      if (patch.description !== undefined) {
        pipeline.description = patch.description;
      }
      if (patch.enabled !== undefined) {
        pipeline.enabled = patch.enabled;
      }
      if (patch.status !== undefined) {
        pipeline.status = patch.status;
      }
      if (patch.nodes !== undefined) {
        pipeline.nodes = patch.nodes;
      }
      if (patch.edges !== undefined) {
        pipeline.edges = patch.edges;
      }
      if (patch.viewport !== undefined) {
        pipeline.viewport = patch.viewport;
      }
      if (patch.runCount !== undefined) {
        pipeline.runCount = patch.runCount;
      }
      pipeline.updatedAtMs = this.now();

      store.pipelines[idx] = pipeline;
      await savePipelineStore(this.state.opts.storePath, store);

      const event = this.makeEvent(
        pipeline.id,
        "pipeline_updated",
        `Pipeline updated: ${pipeline.name}`,
      );
      await appendPipelineEvent(this.state.opts.storePath, event);
      this.emitEvent(event);

      return pipeline;
    });
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(id: string): Promise<void> {
    return locked(this.state, async () => {
      const store = await loadPipelineStore(this.state.opts.storePath);
      const idx = store.pipelines.findIndex((p) => p.id === id);
      if (idx === -1) {
        return;
      }

      const pipeline = store.pipelines[idx]!;
      store.pipelines.splice(idx, 1);
      await savePipelineStore(this.state.opts.storePath, store);

      const event = this.makeEvent(
        pipeline.id,
        "pipeline_deleted",
        `Pipeline deleted: ${pipeline.name}`,
      );
      await appendPipelineEvent(this.state.opts.storePath, event);
      this.emitEvent(event);
    });
  }

  // -------------------------------------------------------------------------
  // activate
  // -------------------------------------------------------------------------

  async activate(id: string): Promise<Pipeline> {
    return locked(this.state, async () => {
      const store = await loadPipelineStore(this.state.opts.storePath);
      const idx = store.pipelines.findIndex((p) => p.id === id);
      if (idx === -1) {
        throw new Error(`Pipeline not found: ${id}`);
      }

      const pipeline = store.pipelines[idx]!;
      pipeline.status = "active";
      pipeline.enabled = true;
      pipeline.updatedAtMs = this.now();

      store.pipelines[idx] = pipeline;
      await savePipelineStore(this.state.opts.storePath, store);

      const event = this.makeEvent(
        pipeline.id,
        "pipeline_enabled",
        `Pipeline activated: ${pipeline.name}`,
      );
      await appendPipelineEvent(this.state.opts.storePath, event);
      this.emitEvent(event);

      return pipeline;
    });
  }

  // -------------------------------------------------------------------------
  // deactivate
  // -------------------------------------------------------------------------

  async deactivate(id: string): Promise<Pipeline> {
    return locked(this.state, async () => {
      const store = await loadPipelineStore(this.state.opts.storePath);
      const idx = store.pipelines.findIndex((p) => p.id === id);
      if (idx === -1) {
        throw new Error(`Pipeline not found: ${id}`);
      }

      const pipeline = store.pipelines[idx]!;
      pipeline.status = "paused";
      pipeline.enabled = false;
      pipeline.updatedAtMs = this.now();

      store.pipelines[idx] = pipeline;
      await savePipelineStore(this.state.opts.storePath, store);

      const event = this.makeEvent(
        pipeline.id,
        "pipeline_disabled",
        `Pipeline deactivated: ${pipeline.name}`,
      );
      await appendPipelineEvent(this.state.opts.storePath, event);
      this.emitEvent(event);

      return pipeline;
    });
  }
}

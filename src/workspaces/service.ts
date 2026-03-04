// ---------------------------------------------------------------------------
// WorkspaceService – Core workspace management service
// ---------------------------------------------------------------------------
// Follows the WidgetService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  Workspace,
  WorkspaceCreateInput,
  WorkspacePatch,
  WorkspaceFilter,
  WorkspaceDirectory,
  WorkspaceDirectoryInput,
  WorkspaceBinding,
} from "./types.js";
import { readWorkspaceStore, writeWorkspaceStore } from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type WorkspaceServiceDeps = {
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

type WorkspaceServiceState = {
  deps: WorkspaceServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: WorkspaceServiceDeps): WorkspaceServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as WidgetService)
// ---------------------------------------------------------------------------

const storeLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: WorkspaceServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// WorkspaceService
// ---------------------------------------------------------------------------

export class WorkspaceService {
  private readonly state: WorkspaceServiceState;

  constructor(deps: WorkspaceServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  private get storePath(): string {
    return this.state.deps.storePath;
  }

  // =========================================================================
  // CRUD
  // =========================================================================

  async create(input: WorkspaceCreateInput): Promise<Workspace> {
    return locked(this.state, async () => {
      const store = await readWorkspaceStore(this.storePath);
      const now = this.now();

      const directories: WorkspaceDirectory[] = (input.directories ?? []).map((d, i) => ({
        id: randomUUID(),
        deviceId: d.deviceId,
        remotePath: d.remotePath,
        label: d.label,
        mountMethod: d.mountMethod ?? "sshfs",
        primary: d.primary ?? i === 0,
      }));

      const ws: Workspace = {
        id: randomUUID(),
        name: input.name,
        description: input.description ?? "",
        directories,
        bindings: [],
        tags: input.tags ?? [],
        createdAtMs: now,
        updatedAtMs: now,
      };

      store.workspaces.push(ws);
      await writeWorkspaceStore(this.storePath, store);

      this.emit("workspace.created", ws);
      this.state.deps.log.info(`workspace created: ${ws.id} — ${ws.name}`);

      return ws;
    });
  }

  async get(id: string): Promise<Workspace | null> {
    const store = await readWorkspaceStore(this.storePath);
    return store.workspaces.find((w) => w.id === id) ?? null;
  }

  async list(filter?: WorkspaceFilter): Promise<Workspace[]> {
    const store = await readWorkspaceStore(this.storePath);
    let list = store.workspaces;

    if (filter) {
      if (filter.tag) {
        list = list.filter((w) => w.tags.includes(filter.tag!));
      }
      if (filter.deviceId) {
        list = list.filter((w) => w.directories.some((d) => d.deviceId === filter.deviceId));
      }
      if (filter.agentId) {
        list = list.filter((w) => w.bindings.some((b) => b.agentId === filter.agentId));
      }
      if (filter.sessionKey) {
        list = list.filter((w) => w.bindings.some((b) => b.sessionKey === filter.sessionKey));
      }
      if (filter.limit && filter.limit > 0) {
        list = list.slice(0, filter.limit);
      }
    }

    return list;
  }

  async update(id: string, patch: WorkspacePatch): Promise<Workspace | null> {
    return locked(this.state, async () => {
      const store = await readWorkspaceStore(this.storePath);
      const idx = store.workspaces.findIndex((w) => w.id === id);
      if (idx === -1) {
        return null;
      }

      const ws = store.workspaces[idx]!;
      if (patch.name !== undefined) {
        ws.name = patch.name;
      }
      if (patch.description !== undefined) {
        ws.description = patch.description;
      }
      if (patch.tags !== undefined) {
        ws.tags = patch.tags;
      }
      ws.updatedAtMs = this.now();

      store.workspaces[idx] = ws;
      await writeWorkspaceStore(this.storePath, store);

      this.emit("workspace.updated", ws);
      this.state.deps.log.info(`workspace updated: ${ws.id}`);

      return ws;
    });
  }

  async delete(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readWorkspaceStore(this.storePath);
      const idx = store.workspaces.findIndex((w) => w.id === id);
      if (idx === -1) {
        return false;
      }

      store.workspaces.splice(idx, 1);
      await writeWorkspaceStore(this.storePath, store);

      this.emit("workspace.deleted", { id });
      this.state.deps.log.info(`workspace deleted: ${id}`);

      return true;
    });
  }

  // =========================================================================
  // Directory management
  // =========================================================================

  async addDirectory(
    workspaceId: string,
    input: WorkspaceDirectoryInput,
  ): Promise<WorkspaceDirectory | null> {
    return locked(this.state, async () => {
      const store = await readWorkspaceStore(this.storePath);
      const ws = store.workspaces.find((w) => w.id === workspaceId);
      if (!ws) {
        return null;
      }

      const dir: WorkspaceDirectory = {
        id: randomUUID(),
        deviceId: input.deviceId,
        remotePath: input.remotePath,
        label: input.label,
        mountMethod: input.mountMethod ?? "sshfs",
        primary: input.primary ?? false,
      };

      // If this is set as primary, unset others
      if (dir.primary) {
        for (const d of ws.directories) {
          d.primary = false;
        }
      }

      ws.directories.push(dir);
      ws.updatedAtMs = this.now();
      await writeWorkspaceStore(this.storePath, store);

      this.emit("workspace.directory.added", { workspaceId, directory: dir });
      this.state.deps.log.info(`directory added to workspace ${workspaceId}: ${dir.label}`);

      return dir;
    });
  }

  async removeDirectory(workspaceId: string, directoryId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readWorkspaceStore(this.storePath);
      const ws = store.workspaces.find((w) => w.id === workspaceId);
      if (!ws) {
        return false;
      }

      const idx = ws.directories.findIndex((d) => d.id === directoryId);
      if (idx === -1) {
        return false;
      }

      ws.directories.splice(idx, 1);
      ws.updatedAtMs = this.now();
      await writeWorkspaceStore(this.storePath, store);

      this.emit("workspace.directory.removed", { workspaceId, directoryId });
      this.state.deps.log.info(`directory removed from workspace ${workspaceId}: ${directoryId}`);

      return true;
    });
  }

  // =========================================================================
  // Binding management
  // =========================================================================

  async bindAgent(workspaceId: string, agentId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readWorkspaceStore(this.storePath);
      const ws = store.workspaces.find((w) => w.id === workspaceId);
      if (!ws) {
        return false;
      }

      // Don't duplicate
      if (ws.bindings.some((b) => b.agentId === agentId)) {
        return true;
      }

      ws.bindings.push({ agentId, boundAtMs: this.now() });
      ws.updatedAtMs = this.now();
      await writeWorkspaceStore(this.storePath, store);

      this.emit("workspace.binding.changed", { workspaceId, action: "bind_agent", agentId });
      this.state.deps.log.info(`agent ${agentId} bound to workspace ${workspaceId}`);

      return true;
    });
  }

  async unbindAgent(workspaceId: string, agentId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readWorkspaceStore(this.storePath);
      const ws = store.workspaces.find((w) => w.id === workspaceId);
      if (!ws) {
        return false;
      }

      const idx = ws.bindings.findIndex((b) => b.agentId === agentId);
      if (idx === -1) {
        return false;
      }

      ws.bindings.splice(idx, 1);
      ws.updatedAtMs = this.now();
      await writeWorkspaceStore(this.storePath, store);

      this.emit("workspace.binding.changed", { workspaceId, action: "unbind_agent", agentId });
      this.state.deps.log.info(`agent ${agentId} unbound from workspace ${workspaceId}`);

      return true;
    });
  }

  async bindSession(workspaceId: string, sessionKey: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readWorkspaceStore(this.storePath);
      const ws = store.workspaces.find((w) => w.id === workspaceId);
      if (!ws) {
        return false;
      }

      if (ws.bindings.some((b) => b.sessionKey === sessionKey)) {
        return true;
      }

      ws.bindings.push({ sessionKey, boundAtMs: this.now() });
      ws.updatedAtMs = this.now();
      await writeWorkspaceStore(this.storePath, store);

      this.emit("workspace.binding.changed", { workspaceId, action: "bind_session", sessionKey });
      this.state.deps.log.info(`session ${sessionKey} bound to workspace ${workspaceId}`);

      return true;
    });
  }

  async unbindSession(workspaceId: string, sessionKey: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readWorkspaceStore(this.storePath);
      const ws = store.workspaces.find((w) => w.id === workspaceId);
      if (!ws) {
        return false;
      }

      const idx = ws.bindings.findIndex((b) => b.sessionKey === sessionKey);
      if (idx === -1) {
        return false;
      }

      ws.bindings.splice(idx, 1);
      ws.updatedAtMs = this.now();
      await writeWorkspaceStore(this.storePath, store);

      this.emit("workspace.binding.changed", { workspaceId, action: "unbind_session", sessionKey });
      this.state.deps.log.info(`session ${sessionKey} unbound from workspace ${workspaceId}`);

      return true;
    });
  }

  // =========================================================================
  // Resolution
  // =========================================================================

  /**
   * Resolve workspace for a session/agent. Priority:
   * 1. Session binding (exact sessionKey match)
   * 2. Agent binding (agentId match)
   * 3. null (no workspace bound)
   */
  async resolveForSession(sessionKey: string, agentId?: string): Promise<Workspace | null> {
    const store = await readWorkspaceStore(this.storePath);

    // 1. Session binding
    const bySession = store.workspaces.find((w) =>
      w.bindings.some((b) => b.sessionKey === sessionKey),
    );
    if (bySession) {
      return bySession;
    }

    // 2. Agent binding
    if (agentId) {
      const byAgent = store.workspaces.find((w) => w.bindings.some((b) => b.agentId === agentId));
      if (byAgent) {
        return byAgent;
      }
    }

    return null;
  }
}

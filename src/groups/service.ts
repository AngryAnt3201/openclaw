// ---------------------------------------------------------------------------
// GroupService – Core group session management service
// ---------------------------------------------------------------------------
// Follows the WidgetService/NotificationService pattern: dependency-injected,
// event-driven, file-backed, with promise-based locking for safe concurrent
// access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  GroupSession,
  GroupMessage,
  GroupCreateInput,
  GroupPatch,
  GroupMessageRole,
  TranscriptFilter,
} from "./types.js";
import {
  readGroupStore,
  writeGroupStore,
  readTranscript,
  writeTranscript,
  resolveTranscriptPath,
} from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type GroupServiceDeps = {
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

type ServiceState = {
  deps: GroupServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: GroupServiceDeps): ServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as TaskService / WidgetService)
// ---------------------------------------------------------------------------

const storeLocks = new Map<string, Promise<unknown>>();

function resolveChain(p: Promise<unknown>): Promise<void> {
  return p.then(
    () => {},
    () => {},
  );
}

async function locked<T>(state: ServiceState, fn: () => Promise<T>): Promise<T> {
  const storePath = state.deps.storePath;
  const storeOp = storeLocks.get(storePath) ?? Promise.resolve();
  const next = Promise.all([resolveChain(state.op), resolveChain(storeOp)]).then(fn);
  const keepAlive = resolveChain(next);
  state.op = keepAlive;
  storeLocks.set(storePath, keepAlive);
  return (await next) as T;
}

// ---------------------------------------------------------------------------
// GroupService
// ---------------------------------------------------------------------------

export class GroupService {
  private readonly state: ServiceState;

  constructor(deps: GroupServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  /** Resolve file path inside the store directory */
  private storeFile(): string {
    return path.join(this.state.deps.storePath, "store.json");
  }

  /** Resolve transcript file path for a group */
  private transcriptFile(groupId: string): string {
    return resolveTranscriptPath(this.state.deps.storePath, groupId);
  }

  // =========================================================================
  // createGroup
  // =========================================================================

  async createGroup(input: GroupCreateInput): Promise<GroupSession> {
    if (!input.agents || input.agents.length === 0) {
      throw new Error("agents list must not be empty");
    }

    return locked(this.state, async () => {
      const store = await readGroupStore(this.storeFile());
      const now = this.now();

      const group: GroupSession = {
        id: randomUUID(),
        label: input.label,
        agents: input.agents,
        activation: input.activation ?? "always",
        historyLimit: input.historyLimit ?? 50,
        createdAt: now,
        updatedAt: now,
      };

      store.groups.push(group);
      await writeGroupStore(this.storeFile(), store);

      this.emit("group.created", group);
      this.state.deps.log.info(`group created: ${group.id} — ${group.label}`);

      return group;
    });
  }

  // =========================================================================
  // getGroup
  // =========================================================================

  async getGroup(groupId: string): Promise<GroupSession | null> {
    const store = await readGroupStore(this.storeFile());
    return store.groups.find((g) => g.id === groupId) ?? null;
  }

  // =========================================================================
  // listGroups
  // =========================================================================

  async listGroups(): Promise<GroupSession[]> {
    const store = await readGroupStore(this.storeFile());
    return store.groups;
  }

  // =========================================================================
  // updateGroup
  // =========================================================================

  async updateGroup(groupId: string, patch: GroupPatch): Promise<GroupSession | null> {
    return locked(this.state, async () => {
      const store = await readGroupStore(this.storeFile());
      const idx = store.groups.findIndex((g) => g.id === groupId);
      if (idx === -1) {
        return null;
      }

      const group = store.groups[idx]!;

      if (patch.label !== undefined) {
        group.label = patch.label;
      }
      if (patch.agents !== undefined) {
        group.agents = patch.agents;
      }
      if (patch.activation !== undefined) {
        group.activation = patch.activation;
      }
      if (patch.historyLimit !== undefined) {
        group.historyLimit = patch.historyLimit;
      }

      group.updatedAt = this.now();
      store.groups[idx] = group;
      await writeGroupStore(this.storeFile(), store);

      this.emit("group.updated", group);
      this.state.deps.log.info(`group updated: ${group.id}`);

      return group;
    });
  }

  // =========================================================================
  // deleteGroup
  // =========================================================================

  async deleteGroup(groupId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readGroupStore(this.storeFile());
      const idx = store.groups.findIndex((g) => g.id === groupId);
      if (idx === -1) {
        return false;
      }

      store.groups.splice(idx, 1);
      await writeGroupStore(this.storeFile(), store);

      // Clean up transcript directory
      const transcriptDir = path.join(this.state.deps.storePath, groupId);
      try {
        await fs.rm(transcriptDir, { recursive: true, force: true });
      } catch {
        // Transcript dir may not exist — ignore
      }

      this.emit("group.deleted", { id: groupId });
      this.state.deps.log.info(`group deleted: ${groupId}`);

      return true;
    });
  }

  // =========================================================================
  // appendMessage
  // =========================================================================

  async appendMessage(
    groupId: string,
    input: {
      role: GroupMessageRole;
      content: string;
      agentId?: string;
      agentName?: string;
      agentColor?: string;
      agentIcon?: string;
      state?: "final" | "streaming" | "error";
    },
  ): Promise<GroupMessage> {
    return locked(this.state, async () => {
      const tFile = this.transcriptFile(groupId);
      const transcript = await readTranscript(tFile, groupId);

      const seq = transcript.lastSeq + 1;
      const now = this.now();

      const message: GroupMessage = {
        id: randomUUID(),
        seq,
        role: input.role,
        agentId: input.agentId,
        agentName: input.agentName,
        agentColor: input.agentColor,
        agentIcon: input.agentIcon,
        content: input.content,
        timestamp: now,
        state: input.state ?? "final",
      };

      transcript.messages.push(message);
      transcript.lastSeq = seq;
      await writeTranscript(tFile, transcript);

      return message;
    });
  }

  // =========================================================================
  // getTranscript
  // =========================================================================

  async getTranscript(groupId: string, filter?: TranscriptFilter): Promise<GroupMessage[]> {
    const tFile = this.transcriptFile(groupId);
    const transcript = await readTranscript(tFile, groupId);
    let messages = transcript.messages;

    if (filter) {
      if (filter.afterSeq !== undefined) {
        const afterSeq = filter.afterSeq;
        messages = messages.filter((m) => m.seq > afterSeq);
      }
      if (filter.limit !== undefined && filter.limit > 0) {
        // Take the last N messages (most recent)
        messages = messages.slice(-filter.limit);
      }
    }

    return messages;
  }
}

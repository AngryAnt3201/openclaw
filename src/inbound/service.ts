// ---------------------------------------------------------------------------
// InboundService – Core inbound message management service
// ---------------------------------------------------------------------------
// Follows the TaskService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  InboundMessage,
  InboundMessageFilter,
  InboundMessageStatus,
  InboundChannel,
  InboundChannelCreateInput,
  InboundChannelPatch,
  InboundRoute,
  InboundRouteCreateInput,
  InboundRoutePatch,
  InboundFilter,
  InboundPriority,
  InboundProcessingResult,
  RawInboundMessage,
} from "./types.js";
import { readInboundStore, writeInboundStore } from "./store.js";
import { PRIORITY_ORDER } from "./types.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type InboundActionExecutor = (
  message: InboundMessage,
  route: InboundRoute,
) => Promise<InboundProcessingResult | null>;

export type InboundServiceDeps = {
  storePath: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
  nowMs?: () => number;
  /** Optional executor for auto-execute route actions. */
  executeAction?: InboundActionExecutor;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type ServiceState = {
  deps: InboundServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: InboundServiceDeps): ServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as tasks/service.ts)
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
// Constants
// ---------------------------------------------------------------------------

const PRUNE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PRUNE_MAX_COUNT = 10_000;

// ---------------------------------------------------------------------------
// InboundService
// ---------------------------------------------------------------------------

export class InboundService {
  private readonly state: ServiceState;

  constructor(deps: InboundServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  // =========================================================================
  // Messages
  // =========================================================================

  // -------------------------------------------------------------------------
  // ingestMessage
  // -------------------------------------------------------------------------

  async ingestMessage(raw: RawInboundMessage): Promise<InboundMessage> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const now = this.now();

      // Dedup by externalId
      if (raw.externalId) {
        const existing = store.messages.find((m) => m.externalId === raw.externalId);
        if (existing) {
          this.state.deps.log.info(`inbound dedup: externalId=${raw.externalId}`);
          return existing;
        }
      }

      // Resolve priority: raw → channel default → "medium"
      let priority: InboundPriority = raw.priority ?? "medium";
      if (!raw.priority) {
        const channel = store.channels.find((c) => c.id === raw.source.channelId);
        if (channel?.defaultPriority) {
          priority = channel.defaultPriority;
        }
      }

      const message: InboundMessage = {
        id: randomUUID(),
        source: raw.source,
        status: "pending",
        priority,
        body: raw.body,
        subject: raw.subject,
        intent: raw.intent,
        attachments: raw.attachments,
        metadata: raw.metadata,
        externalId: raw.externalId,
        createdAtMs: now,
        updatedAtMs: now,
      };

      // Route matching
      const matched = this.matchRouteSync(store.routes, message);
      if (matched) {
        if (matched.autoExecute) {
          message.status = "processing";
          // Execute the action after persisting (fire-and-forget outside lock)
          const executeAfter = this.state.deps.executeAction;
          if (executeAfter) {
            const msgCopy = { ...message };
            const routeCopy = { ...matched };
            // Schedule outside the lock
            queueMicrotask(() => {
              void executeAfter(msgCopy, routeCopy)
                .then(async (result) => {
                  if (result) {
                    await this.markProcessed(msgCopy.id, result);
                  }
                })
                .catch((err) => {
                  this.state.deps.log.error(`inbound action execution failed: ${String(err)}`);
                });
            });
          }
        } else {
          message.pendingAction = {
            routeId: matched.id,
            routeName: matched.name,
            action: matched.action,
          };
        }
      }

      store.messages.push(message);

      // Increment channel messageCount
      const ch = store.channels.find((c) => c.id === raw.source.channelId);
      if (ch) {
        ch.messageCount = (ch.messageCount ?? 0) + 1;
      }

      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.message.created", message);
      this.state.deps.log.info(`inbound message created: ${message.id}`);

      return message;
    });
  }

  // -------------------------------------------------------------------------
  // listMessages
  // -------------------------------------------------------------------------

  async listMessages(filter?: InboundMessageFilter): Promise<InboundMessage[]> {
    const store = await readInboundStore(this.state.deps.storePath);
    let msgs = store.messages;

    if (filter) {
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        const set = new Set<InboundMessageStatus>(statuses);
        msgs = msgs.filter((m) => set.has(m.status));
      }
      if (filter.sourceType) {
        const types = Array.isArray(filter.sourceType) ? filter.sourceType : [filter.sourceType];
        const set = new Set(types);
        msgs = msgs.filter((m) => set.has(m.source.type));
      }
      if (filter.channelId) {
        msgs = msgs.filter((m) => m.source.channelId === filter.channelId);
      }
      if (filter.priority) {
        const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
        const set = new Set(priorities);
        msgs = msgs.filter((m) => set.has(m.priority));
      }
      if (filter.taskId) {
        msgs = msgs.filter((m) => m.taskId === filter.taskId);
      }
      if (filter.since) {
        msgs = msgs.filter((m) => m.createdAtMs >= filter.since!);
      }
      if (filter.limit && filter.limit > 0) {
        msgs = msgs.slice(0, filter.limit);
      }
    }

    return msgs;
  }

  // -------------------------------------------------------------------------
  // getMessage
  // -------------------------------------------------------------------------

  async getMessage(id: string): Promise<InboundMessage | null> {
    const store = await readInboundStore(this.state.deps.storePath);
    return store.messages.find((m) => m.id === id) ?? null;
  }

  // -------------------------------------------------------------------------
  // markProcessed
  // -------------------------------------------------------------------------

  async markProcessed(
    id: string,
    result?: InboundProcessingResult,
  ): Promise<InboundMessage | null> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const idx = store.messages.findIndex((m) => m.id === id);
      if (idx === -1) {
        return null;
      }

      const msg = store.messages[idx]!;
      msg.status = "processed";
      msg.processedAtMs = this.now();
      msg.pendingAction = undefined;
      if (result) {
        msg.result = result;
      }
      msg.updatedAtMs = this.now();

      store.messages[idx] = msg;
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.message.updated", msg);
      return msg;
    });
  }

  // -------------------------------------------------------------------------
  // deleteMessage
  // -------------------------------------------------------------------------

  async deleteMessage(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const idx = store.messages.findIndex((m) => m.id === id);
      if (idx === -1) {
        return false;
      }

      store.messages.splice(idx, 1);
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.message.deleted", { id });
      this.state.deps.log.info(`inbound message deleted: ${id}`);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // linkToTask
  // -------------------------------------------------------------------------

  async linkToTask(messageId: string, taskId: string): Promise<InboundMessage | null> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const idx = store.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) {
        return null;
      }

      const msg = store.messages[idx]!;
      msg.taskId = taskId;
      msg.updatedAtMs = this.now();
      store.messages[idx] = msg;
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.message.updated", msg);
      return msg;
    });
  }

  // -------------------------------------------------------------------------
  // getUnprocessedCount
  // -------------------------------------------------------------------------

  async getUnprocessedCount(): Promise<number> {
    const store = await readInboundStore(this.state.deps.storePath);
    const done = new Set<InboundMessageStatus>(["processed", "ignored"]);
    return store.messages.filter((m) => !done.has(m.status)).length;
  }

  // =========================================================================
  // Channels
  // =========================================================================

  async listChannels(): Promise<InboundChannel[]> {
    const store = await readInboundStore(this.state.deps.storePath);
    return store.channels;
  }

  async addChannel(input: InboundChannelCreateInput): Promise<InboundChannel> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const now = this.now();

      const channel: InboundChannel = {
        id: randomUUID(),
        type: input.type,
        name: input.name,
        enabled: input.enabled ?? true,
        config: input.config,
        defaultPriority: input.defaultPriority,
        messageCount: 0,
        createdAtMs: now,
        updatedAtMs: now,
      };

      store.channels.push(channel);
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.channel.added", channel);
      this.state.deps.log.info(`inbound channel added: ${channel.id} — ${channel.name}`);
      return channel;
    });
  }

  async updateChannel(id: string, patch: InboundChannelPatch): Promise<InboundChannel | null> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const idx = store.channels.findIndex((c) => c.id === id);
      if (idx === -1) {
        return null;
      }

      const ch = store.channels[idx]!;
      if (patch.name !== undefined) {
        ch.name = patch.name;
      }
      if (patch.enabled !== undefined) {
        ch.enabled = patch.enabled;
      }
      if (patch.status !== undefined) {
        ch.status = patch.status;
      }
      if (patch.lastSyncMs !== undefined) {
        ch.lastSyncMs = patch.lastSyncMs;
      }
      if (patch.errorMessage !== undefined) {
        ch.errorMessage = patch.errorMessage;
      }
      if (patch.config !== undefined) {
        ch.config = patch.config;
      }
      if (patch.defaultPriority !== undefined) {
        ch.defaultPriority = patch.defaultPriority;
      }
      ch.updatedAtMs = this.now();

      store.channels[idx] = ch;
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.channel.updated", ch);
      return ch;
    });
  }

  async removeChannel(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const idx = store.channels.findIndex((c) => c.id === id);
      if (idx === -1) {
        return false;
      }

      store.channels.splice(idx, 1);
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.channel.removed", { id });
      this.state.deps.log.info(`inbound channel removed: ${id}`);
      return true;
    });
  }

  // =========================================================================
  // Routes
  // =========================================================================

  async listRoutes(): Promise<InboundRoute[]> {
    const store = await readInboundStore(this.state.deps.storePath);
    return [...store.routes].toSorted((a, b) => a.order - b.order);
  }

  async addRoute(input: InboundRouteCreateInput): Promise<InboundRoute> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const now = this.now();

      // Auto-assign order if not provided
      const maxOrder = store.routes.reduce((max, r) => Math.max(max, r.order), -1);

      const route: InboundRoute = {
        id: randomUUID(),
        name: input.name,
        enabled: input.enabled ?? true,
        filter: input.filter,
        action: input.action,
        autoExecute: input.autoExecute ?? false,
        order: input.order ?? maxOrder + 1,
        createdAtMs: now,
        updatedAtMs: now,
      };

      store.routes.push(route);
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.route.added", route);
      this.state.deps.log.info(`inbound route added: ${route.id} — ${route.name}`);
      return route;
    });
  }

  async updateRoute(id: string, patch: InboundRoutePatch): Promise<InboundRoute | null> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const idx = store.routes.findIndex((r) => r.id === id);
      if (idx === -1) {
        return null;
      }

      const route = store.routes[idx]!;
      if (patch.name !== undefined) {
        route.name = patch.name;
      }
      if (patch.enabled !== undefined) {
        route.enabled = patch.enabled;
      }
      if (patch.filter !== undefined) {
        route.filter = patch.filter;
      }
      if (patch.action !== undefined) {
        route.action = patch.action;
      }
      if (patch.autoExecute !== undefined) {
        route.autoExecute = patch.autoExecute;
      }
      if (patch.order !== undefined) {
        route.order = patch.order;
      }
      route.updatedAtMs = this.now();

      store.routes[idx] = route;
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.route.updated", route);
      return route;
    });
  }

  async removeRoute(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const idx = store.routes.findIndex((r) => r.id === id);
      if (idx === -1) {
        return false;
      }

      store.routes.splice(idx, 1);
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.route.removed", { id });
      this.state.deps.log.info(`inbound route removed: ${id}`);
      return true;
    });
  }

  // =========================================================================
  // Route Matching (private)
  // =========================================================================

  private matchRouteSync(routes: InboundRoute[], message: InboundMessage): InboundRoute | null {
    const enabled = routes.filter((r) => r.enabled);
    const sorted = [...enabled].toSorted((a, b) => a.order - b.order);

    for (const route of sorted) {
      if (this.filterMatches(route.filter, message)) {
        return route;
      }
    }
    return null;
  }

  private filterMatches(filter: InboundFilter, msg: InboundMessage): boolean {
    // sourceTypes
    if (filter.sourceTypes && filter.sourceTypes.length > 0) {
      if (!filter.sourceTypes.includes(msg.source.type)) {
        return false;
      }
    }

    // channelIds
    if (filter.channelIds && filter.channelIds.length > 0) {
      if (!filter.channelIds.includes(msg.source.channelId)) {
        return false;
      }
    }

    // senderIds
    if (filter.senderIds && filter.senderIds.length > 0) {
      if (!msg.source.senderId || !filter.senderIds.includes(msg.source.senderId)) {
        return false;
      }
    }

    // minPriority
    if (filter.minPriority) {
      const msgRank = PRIORITY_ORDER[msg.priority];
      const minRank = PRIORITY_ORDER[filter.minPriority];
      if (msgRank > minRank) {
        return false;
      } // higher number = lower priority
    }

    // keywords (case-insensitive body + subject search)
    if (filter.keywords && filter.keywords.length > 0) {
      const text = ((msg.body ?? "") + " " + (msg.subject ?? "")).toLowerCase();
      const matched = filter.keywords.some((kw) => text.includes(kw.toLowerCase()));
      if (!matched) {
        return false;
      }
    }

    // intents
    if (filter.intents && filter.intents.length > 0) {
      if (!msg.intent || !filter.intents.includes(msg.intent)) {
        return false;
      }
    }

    return true;
  }

  // =========================================================================
  // Prune
  // =========================================================================

  async prune(): Promise<number> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const now = this.now();
      const before = store.messages.length;

      // Remove messages older than 30 days
      store.messages = store.messages.filter((m) => now - m.createdAtMs < PRUNE_TTL_MS);

      // Enforce cap: keep newest 10,000
      if (store.messages.length > PRUNE_MAX_COUNT) {
        store.messages.sort((a, b) => b.createdAtMs - a.createdAtMs);
        store.messages = store.messages.slice(0, PRUNE_MAX_COUNT);
      }

      const removed = before - store.messages.length;
      if (removed > 0) {
        await writeInboundStore(this.state.deps.storePath, store);
        this.state.deps.log.info(`inbound prune: removed ${removed} message(s)`);
      }

      return removed;
    });
  }
}

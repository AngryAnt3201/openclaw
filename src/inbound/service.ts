// ---------------------------------------------------------------------------
// InboundService – Core inbound message management service
// ---------------------------------------------------------------------------
// Follows the TaskService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  InboundMessage,
  InboundMessageStatus,
  InboundMessageQuery,
  InboundMessagePage,
  InboundCounts,
  InboundChannel,
  InboundChannelCreateInput,
  InboundChannelPatch,
  InboundRoute,
  InboundRouteCreateInput,
  InboundRoutePatch,
  InboundFilter,
  InboundProcessingResult,
  RawInboundMessage,
  InboundStoreFile,
} from "./types.js";
import { readInboundStore, writeInboundStore } from "./store.js";

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
  /** Optional task creator for non-auto routes (replaces pendingAction). */
  createPendingTask?: (message: InboundMessage, route: InboundRoute) => Promise<string | null>;
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
const DEFAULT_PAGE_LIMIT = 50;

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
  // Snooze expiry (private)
  // =========================================================================

  /**
   * Scan for snoozed messages past their `snoozedUntilMs` and revert them
   * to `unread`. Returns true if any messages were unsnoozed (store was
   * mutated and needs persisting).
   */
  private checkSnoozeExpiry(store: InboundStoreFile): boolean {
    const now = this.now();
    let mutated = false;

    for (const msg of store.messages) {
      if (
        msg.status === "snoozed" &&
        msg.snoozedUntilMs !== undefined &&
        msg.snoozedUntilMs <= now
      ) {
        msg.status = "unread";
        msg.snoozedUntilMs = undefined;
        msg.updatedAtMs = now;
        mutated = true;
      }
    }

    return mutated;
  }

  // =========================================================================
  // Query matching (private)
  // =========================================================================

  /**
   * Apply an InboundMessageQuery filter to a message. Returns true if the
   * message matches all specified query criteria.
   */
  private queryMatches(
    query: InboundMessageQuery,
    msg: InboundMessage,
    allMessages: InboundMessage[],
  ): boolean {
    if (query.sourceTypes && query.sourceTypes.length > 0) {
      if (!query.sourceTypes.includes(msg.source.type)) {
        return false;
      }
    }

    if (query.channelIds && query.channelIds.length > 0) {
      if (!query.channelIds.includes(msg.source.channelId)) {
        return false;
      }
    }

    if (query.senderName) {
      const senderName = msg.source.senderName ?? "";
      if (!senderName.toLowerCase().includes(query.senderName.toLowerCase())) {
        return false;
      }
    }

    if (query.status && query.status.length > 0) {
      const set = new Set<InboundMessageStatus>(query.status);
      if (!set.has(msg.status)) {
        return false;
      }
    }

    if (query.hasAttachment !== undefined) {
      const has = Array.isArray(msg.attachments) && msg.attachments.length > 0;
      if (query.hasAttachment !== has) {
        return false;
      }
    }

    if (query.hasTask !== undefined) {
      const has = msg.taskId !== undefined && msg.taskId !== null && msg.taskId !== "";
      if (query.hasTask !== has) {
        return false;
      }
    }

    if (query.hasThread !== undefined) {
      // For Slack: check if any other message shares the same threadTs
      const meta = msg.source.platformMeta as Record<string, unknown> | undefined;
      let hasThread = false;
      if (meta && msg.source.type === "slack") {
        const messageTs = meta.messageTs as string | undefined;
        const threadTs = meta.threadTs as string | undefined;
        const ts = threadTs ?? messageTs;
        if (ts) {
          hasThread = allMessages.some((other) => {
            if (other.id === msg.id) {
              return false;
            }
            const otherMeta = other.source.platformMeta as Record<string, unknown> | undefined;
            if (!otherMeta || other.source.type !== "slack") {
              return false;
            }
            const otherMessageTs = otherMeta.messageTs as string | undefined;
            const otherThreadTs = otherMeta.threadTs as string | undefined;
            return otherThreadTs === ts || otherMessageTs === ts;
          });
        }
      }
      if (query.hasThread !== hasThread) {
        return false;
      }
    }

    if (query.mentionsUser) {
      const searchName = query.mentionsUser.toLowerCase();
      const found = msg.mentions.some((m) => m.name.toLowerCase().includes(searchName));
      if (!found) {
        return false;
      }
    }

    if (query.beforeMs !== undefined) {
      if (msg.createdAtMs >= query.beforeMs) {
        return false;
      }
    }

    if (query.afterMs !== undefined) {
      if (msg.createdAtMs <= query.afterMs) {
        return false;
      }
    }

    if (query.searchText) {
      const text = query.searchText.toLowerCase();
      const searchable = [msg.bodyResolved, msg.subject ?? "", msg.source.senderName ?? ""]
        .join(" ")
        .toLowerCase();
      if (!searchable.includes(text)) {
        return false;
      }
    }

    return true;
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

      const message: InboundMessage = {
        id: randomUUID(),
        source: raw.source,
        status: "unread",
        direction: "inbound",
        body: raw.body,
        bodyResolved: raw.bodyResolved ?? raw.body,
        mentions: raw.mentions ?? [],
        subject: raw.subject,
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
          message.status = "read";
          message.readAtMs = now;
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
                    await this.setStatus(msgCopy.id, "archived");
                    if (result.taskId) {
                      await this.linkToTask(msgCopy.id, result.taskId);
                    }
                  }
                })
                .catch((err) => {
                  this.state.deps.log.error(`inbound action execution failed: ${String(err)}`);
                });
            });
          }
        } else {
          // Non-auto route: create a pending task and link via taskId
          const createTask = this.state.deps.createPendingTask;
          if (createTask) {
            const msgCopy = { ...message };
            const routeCopy = { ...matched };
            queueMicrotask(() => {
              void createTask(msgCopy, routeCopy)
                .then(async (taskId) => {
                  if (taskId) {
                    await this.linkToTask(msgCopy.id, taskId);
                  }
                })
                .catch((err) => {
                  this.state.deps.log.error(`inbound pending task creation failed: ${String(err)}`);
                });
            });
          }
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
  // listMessages (paginated with InboundMessageQuery)
  // -------------------------------------------------------------------------

  async listMessages(
    query?: InboundMessageQuery,
    cursor?: string,
    limit?: number,
  ): Promise<InboundMessagePage> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);

      // Lazy snooze expiry check
      const snoozeMutated = this.checkSnoozeExpiry(store);
      if (snoozeMutated) {
        await writeInboundStore(this.state.deps.storePath, store);
      }

      // Sort by createdAtMs descending (newest first)
      let msgs = [...store.messages].toSorted((a, b) => b.createdAtMs - a.createdAtMs);

      // Apply query filters
      if (query) {
        msgs = msgs.filter((m) => this.queryMatches(query, m, store.messages));
      }

      const totalCount = msgs.length;

      // Apply cursor (cursor = createdAtMs of last message in previous page)
      if (cursor) {
        const cursorMs = Number(cursor);
        if (!Number.isNaN(cursorMs)) {
          // Since sorted descending, skip messages with createdAtMs >= cursorMs
          const cursorIdx = msgs.findIndex((m) => m.createdAtMs < cursorMs);
          if (cursorIdx === -1) {
            return { messages: [], nextCursor: null, totalCount };
          }
          msgs = msgs.slice(cursorIdx);
        }
      }

      // Apply limit
      const pageLimit = limit ?? DEFAULT_PAGE_LIMIT;
      const page = msgs.slice(0, pageLimit);

      // Compute next cursor
      let nextCursor: string | null = null;
      if (page.length > 0 && page.length < msgs.length) {
        nextCursor = String(page[page.length - 1]!.createdAtMs);
      }

      return { messages: page, nextCursor, totalCount };
    });
  }

  // -------------------------------------------------------------------------
  // getMessage
  // -------------------------------------------------------------------------

  async getMessage(id: string): Promise<InboundMessage | null> {
    const store = await readInboundStore(this.state.deps.storePath);
    return store.messages.find((m) => m.id === id) ?? null;
  }

  // -------------------------------------------------------------------------
  // setStatus
  // -------------------------------------------------------------------------

  async setStatus(
    messageId: string,
    status: InboundMessageStatus,
    snoozedUntilMs?: number,
  ): Promise<InboundMessage | null> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const idx = store.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) {
        return null;
      }

      const msg = store.messages[idx]!;
      const now = this.now();

      msg.status = status;
      msg.updatedAtMs = now;

      // Set appropriate timestamp fields
      switch (status) {
        case "read":
          if (msg.readAtMs === undefined) {
            msg.readAtMs = now;
          }
          break;
        case "flagged":
          msg.flaggedAtMs = now;
          break;
        case "archived":
          msg.archivedAtMs = now;
          break;
        case "snoozed":
          msg.snoozedUntilMs = snoozedUntilMs;
          break;
        case "unread":
          // Clear snooze when reverting to unread
          msg.snoozedUntilMs = undefined;
          break;
      }

      store.messages[idx] = msg;
      await writeInboundStore(this.state.deps.storePath, store);

      this.emit("inbound.message.updated", msg);
      return msg;
    });
  }

  // -------------------------------------------------------------------------
  // bulkSetStatus
  // -------------------------------------------------------------------------

  async bulkSetStatus(
    messageIds: string[],
    status: InboundMessageStatus,
    snoozedUntilMs?: number,
  ): Promise<InboundMessage[]> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);
      const now = this.now();
      const idSet = new Set(messageIds);
      const updated: InboundMessage[] = [];

      for (let i = 0; i < store.messages.length; i++) {
        const msg = store.messages[i]!;
        if (!idSet.has(msg.id)) {
          continue;
        }

        msg.status = status;
        msg.updatedAtMs = now;

        switch (status) {
          case "read":
            if (msg.readAtMs === undefined) {
              msg.readAtMs = now;
            }
            break;
          case "flagged":
            msg.flaggedAtMs = now;
            break;
          case "archived":
            msg.archivedAtMs = now;
            break;
          case "snoozed":
            msg.snoozedUntilMs = snoozedUntilMs;
            break;
          case "unread":
            msg.snoozedUntilMs = undefined;
            break;
        }

        store.messages[i] = msg;
        updated.push(msg);
      }

      if (updated.length > 0) {
        await writeInboundStore(this.state.deps.storePath, store);
        for (const msg of updated) {
          this.emit("inbound.message.updated", msg);
        }
      }

      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // getCounts
  // -------------------------------------------------------------------------

  async getCounts(): Promise<InboundCounts> {
    return locked(this.state, async () => {
      const store = await readInboundStore(this.state.deps.storePath);

      // Lazy snooze expiry check
      const snoozeMutated = this.checkSnoozeExpiry(store);
      if (snoozeMutated) {
        await writeInboundStore(this.state.deps.storePath, store);
      }

      const counts: InboundCounts = {
        unread: 0,
        read: 0,
        flagged: 0,
        snoozed: 0,
        archived: 0,
        bySource: {},
        byChannel: {},
      };

      for (const msg of store.messages) {
        // Count by status
        switch (msg.status) {
          case "unread":
            counts.unread++;
            break;
          case "read":
            counts.read++;
            break;
          case "flagged":
            counts.flagged++;
            break;
          case "snoozed":
            counts.snoozed++;
            break;
          case "archived":
            counts.archived++;
            break;
        }

        // Count by source type
        counts.bySource[msg.source.type] = (counts.bySource[msg.source.type] ?? 0) + 1;

        // Count by channel
        counts.byChannel[msg.source.channelId] = (counts.byChannel[msg.source.channelId] ?? 0) + 1;
      }

      return counts;
    });
  }

  // -------------------------------------------------------------------------
  // markProcessed (deprecated — use setStatus instead)
  // -------------------------------------------------------------------------

  /**
   * @deprecated Use `setStatus(id, "archived")` instead.
   * Kept for backward compatibility.
   */
  async markProcessed(
    id: string,
    _result?: InboundProcessingResult,
  ): Promise<InboundMessage | null> {
    return this.setStatus(id, "archived");
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
  // getUnprocessedCount (deprecated — use getCounts instead)
  // -------------------------------------------------------------------------

  /**
   * @deprecated Use `getCounts()` instead which returns counts per status.
   * Kept for backward compatibility.
   */
  async getUnprocessedCount(): Promise<number> {
    const counts = await this.getCounts();
    return counts.unread + counts.read + counts.flagged + counts.snoozed;
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

    // minPriority — no-op (priority field removed from messages)
    // Existing routes with minPriority set will simply match all messages.

    // keywords (case-insensitive body + subject search)
    if (filter.keywords && filter.keywords.length > 0) {
      const text = ((msg.body ?? "") + " " + (msg.subject ?? "")).toLowerCase();
      const matched = filter.keywords.some((kw) => text.includes(kw.toLowerCase()));
      if (!matched) {
        return false;
      }
    }

    // intents — no-op (intent field removed from messages)
    // Existing routes with intents set will simply match all messages.

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

// ---------------------------------------------------------------------------
// NotificationService – Core notification management service
// ---------------------------------------------------------------------------
// Mirrors TaskService: dependency-injected, event-driven, file-backed,
// with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  Notification,
  NotificationChannelDelivery,
  NotificationCreateInput,
  NotificationFilter,
  NotificationPreferences,
  NotificationStatus,
} from "./types.js";
import { type DispatchDeps, dispatchNotification, resolveChannels } from "./dispatch.js";
import { readNotificationStore, writeNotificationStore, defaultPreferences } from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type NotificationServiceDeps = {
  storePath: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
  dispatch?: DispatchDeps;
  nowMs?: () => number;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type ServiceState = {
  deps: NotificationServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: NotificationServiceDeps): ServiceState {
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
// Auto-prune constants
// ---------------------------------------------------------------------------

const PRUNE_THRESHOLD = 1000;
const PRUNE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------

export class NotificationService {
  private readonly state: ServiceState;

  constructor(deps: NotificationServiceDeps) {
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

  async create(input: NotificationCreateInput): Promise<Notification> {
    return locked(this.state, async () => {
      const store = await readNotificationStore(this.state.deps.storePath);
      const now = this.now();

      const notification: Notification = {
        id: randomUUID(),
        type: input.type,
        title: input.title,
        body: input.body,
        priority: input.priority ?? "medium",
        status: "unread",
        taskId: input.taskId,
        agentId: input.agentId,
        source: input.source,
        channels: [],
        createdAtMs: now,
        updatedAtMs: now,
        data: input.data,
      };

      store.notifications.push(notification);

      // Auto-prune old dismissed notifications
      if (store.notifications.length > PRUNE_THRESHOLD) {
        const cutoff = now - PRUNE_MAX_AGE_MS;
        store.notifications = store.notifications.filter(
          (n) => n.status !== "dismissed" || n.createdAtMs > cutoff,
        );
      }

      await writeNotificationStore(this.state.deps.storePath, store);

      this.emit("notification.created", notification);
      this.state.deps.log.info(`notification created: ${notification.id} — ${notification.title}`);

      // Dispatch to external channels in the background
      if (this.state.deps.dispatch) {
        const channels = resolveChannels(notification, store.preferences, input.channels);
        if (channels.length > 0) {
          void this.dispatchAndRecord(notification.id, notification, channels, store.preferences);
        }
      }

      return notification;
    });
  }

  private async dispatchAndRecord(
    notificationId: string,
    notification: Notification,
    channels: string[],
    preferences: NotificationPreferences,
  ): Promise<void> {
    if (!this.state.deps.dispatch) {
      return;
    }

    try {
      const results = await dispatchNotification(
        this.state.deps.dispatch,
        notification,
        channels,
        preferences,
      );

      // Update channel delivery records
      const deliveries: NotificationChannelDelivery[] = results.map((r) => ({
        channel: r.channel,
        status: r.success ? ("sent" as const) : ("failed" as const),
        sentAtMs: r.success ? this.now() : undefined,
        error: r.error,
      }));

      if (deliveries.length > 0) {
        await locked(this.state, async () => {
          const store = await readNotificationStore(this.state.deps.storePath);
          const idx = store.notifications.findIndex((n) => n.id === notificationId);
          if (idx !== -1) {
            store.notifications[idx]!.channels = deliveries;
            store.notifications[idx]!.updatedAtMs = this.now();
            await writeNotificationStore(this.state.deps.storePath, store);
          }
        });
      }
    } catch (err) {
      this.state.deps.log.error(`dispatch failed for ${notificationId}: ${String(err)}`);
    }
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  async list(filter?: NotificationFilter): Promise<Notification[]> {
    const store = await readNotificationStore(this.state.deps.storePath);
    let notifications = store.notifications;

    if (filter) {
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        const statusSet = new Set<NotificationStatus>(statuses);
        notifications = notifications.filter((n) => statusSet.has(n.status));
      }
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        const typeSet = new Set(types);
        notifications = notifications.filter((n) => typeSet.has(n.type));
      }
      if (filter.priority) {
        const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
        const prioritySet = new Set(priorities);
        notifications = notifications.filter((n) => prioritySet.has(n.priority));
      }
      if (filter.taskId) {
        notifications = notifications.filter((n) => n.taskId === filter.taskId);
      }
      if (filter.since) {
        const since = filter.since;
        notifications = notifications.filter((n) => n.createdAtMs >= since);
      }
      if (filter.limit && filter.limit > 0) {
        notifications = notifications.slice(-filter.limit);
      }
    }

    // Return newest first
    return notifications.toReversed();
  }

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  async get(id: string): Promise<Notification | null> {
    const store = await readNotificationStore(this.state.deps.storePath);
    return store.notifications.find((n) => n.id === id) ?? null;
  }

  // -------------------------------------------------------------------------
  // markRead
  // -------------------------------------------------------------------------

  async markRead(id: string): Promise<Notification | null> {
    return locked(this.state, async () => {
      const store = await readNotificationStore(this.state.deps.storePath);
      const idx = store.notifications.findIndex((n) => n.id === id);
      if (idx === -1) {
        return null;
      }

      const notification = store.notifications[idx]!;
      notification.status = "read";
      notification.readAtMs = this.now();
      notification.updatedAtMs = this.now();
      store.notifications[idx] = notification;
      await writeNotificationStore(this.state.deps.storePath, store);

      this.emit("notification.read", { id });
      return notification;
    });
  }

  // -------------------------------------------------------------------------
  // markAllRead
  // -------------------------------------------------------------------------

  async markAllRead(): Promise<number> {
    return locked(this.state, async () => {
      const store = await readNotificationStore(this.state.deps.storePath);
      const now = this.now();
      let count = 0;

      for (const n of store.notifications) {
        if (n.status === "unread") {
          n.status = "read";
          n.readAtMs = now;
          n.updatedAtMs = now;
          count++;
        }
      }

      if (count > 0) {
        await writeNotificationStore(this.state.deps.storePath, store);
        this.emit("notification.allRead", { count });
      }

      return count;
    });
  }

  // -------------------------------------------------------------------------
  // dismiss
  // -------------------------------------------------------------------------

  async dismiss(id: string): Promise<Notification | null> {
    return locked(this.state, async () => {
      const store = await readNotificationStore(this.state.deps.storePath);
      const idx = store.notifications.findIndex((n) => n.id === id);
      if (idx === -1) {
        return null;
      }

      const notification = store.notifications[idx]!;
      notification.status = "dismissed";
      notification.dismissedAtMs = this.now();
      notification.updatedAtMs = this.now();
      store.notifications[idx] = notification;
      await writeNotificationStore(this.state.deps.storePath, store);

      this.emit("notification.dismissed", { id });
      return notification;
    });
  }

  // -------------------------------------------------------------------------
  // dismissAll
  // -------------------------------------------------------------------------

  async dismissAll(): Promise<number> {
    return locked(this.state, async () => {
      const store = await readNotificationStore(this.state.deps.storePath);
      const now = this.now();
      let count = 0;

      for (const n of store.notifications) {
        if (n.status !== "dismissed") {
          n.status = "dismissed";
          n.dismissedAtMs = now;
          n.updatedAtMs = now;
          count++;
        }
      }

      if (count > 0) {
        await writeNotificationStore(this.state.deps.storePath, store);
        this.emit("notification.allDismissed", { count });
      }

      return count;
    });
  }

  // -------------------------------------------------------------------------
  // getUnreadCount
  // -------------------------------------------------------------------------

  async getUnreadCount(): Promise<number> {
    const store = await readNotificationStore(this.state.deps.storePath);
    return store.notifications.filter((n) => n.status === "unread").length;
  }

  // -------------------------------------------------------------------------
  // getPreferences
  // -------------------------------------------------------------------------

  async getPreferences(): Promise<NotificationPreferences> {
    const store = await readNotificationStore(this.state.deps.storePath);
    return store.preferences;
  }

  // -------------------------------------------------------------------------
  // updatePreferences
  // -------------------------------------------------------------------------

  async updatePreferences(
    patch: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    return locked(this.state, async () => {
      const store = await readNotificationStore(this.state.deps.storePath);

      if (patch.enabled !== undefined) {
        store.preferences.enabled = patch.enabled;
      }
      if (patch.defaultChannels !== undefined) {
        store.preferences.defaultChannels = patch.defaultChannels;
      }
      if (patch.routes !== undefined) {
        store.preferences.routes = { ...store.preferences.routes, ...patch.routes };
      }
      if (patch.quietHours !== undefined) {
        store.preferences.quietHours = patch.quietHours;
      }
      if (patch.webhooks !== undefined) {
        store.preferences.webhooks = patch.webhooks;
      }
      if (patch.nodePushEnabled !== undefined) {
        store.preferences.nodePushEnabled = patch.nodePushEnabled;
      }

      await writeNotificationStore(this.state.deps.storePath, store);

      this.emit("notification.preferences.updated", store.preferences);
      return store.preferences;
    });
  }
}

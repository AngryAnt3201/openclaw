// ---------------------------------------------------------------------------
// AnalyticsService – Core analytics + SLA management service
// ---------------------------------------------------------------------------
// Follows the PeopleService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  InboundAnalytics,
  SLAProfile,
  SLAProfilePatch,
  ResponseTimeEntry,
  SLAStatus,
} from "./types.js";
import { readAnalyticsStore, writeAnalyticsStore } from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type AnalyticsServiceDeps = {
  storePath: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  broadcast: (event: string, payload: unknown) => void;
  nowMs?: () => number;
  getInboundMessages?: (
    from: number,
    to: number,
  ) => Promise<
    Array<{
      id: string;
      personId?: string;
      source: { type: string; senderName?: string };
      createdAtMs: number;
      direction: string;
    }>
  >;
  getTriages?: (messageIds: string[]) => Promise<
    Array<{
      messageId: string;
      topics: Array<{ label: string }>;
      sentiment: string;
    }>
  >;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type ServiceState = {
  deps: AnalyticsServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: AnalyticsServiceDeps): ServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as people/service.ts)
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
// AnalyticsService
// ---------------------------------------------------------------------------

export class AnalyticsService {
  private readonly state: ServiceState;

  constructor(deps: AnalyticsServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  // =========================================================================
  // SLA Profile CRUD
  // =========================================================================

  async createSLAProfile(input: {
    name: string;
    targetResponseMs: number;
    escalateAfterMs: number;
    appliesTo: "person" | "org";
    entityIds?: string[];
  }): Promise<SLAProfile> {
    return locked(this.state, async () => {
      const store = await readAnalyticsStore(this.state.deps.storePath);

      const profile: SLAProfile = {
        id: randomUUID(),
        name: input.name,
        targetResponseMs: input.targetResponseMs,
        escalateAfterMs: input.escalateAfterMs,
        appliesTo: input.appliesTo,
        entityIds: input.entityIds ?? [],
      };

      store.slaProfiles.push(profile);
      await writeAnalyticsStore(this.state.deps.storePath, store);

      this.emit("sla.profile.created", profile);
      this.state.deps.log.info(`SLA profile created: ${profile.id}`);
      return profile;
    });
  }

  async getSLAProfile(id: string): Promise<SLAProfile | null> {
    const store = await readAnalyticsStore(this.state.deps.storePath);
    return store.slaProfiles.find((p) => p.id === id) ?? null;
  }

  async listSLAProfiles(): Promise<SLAProfile[]> {
    const store = await readAnalyticsStore(this.state.deps.storePath);
    return store.slaProfiles;
  }

  async updateSLAProfile(id: string, patch: SLAProfilePatch): Promise<SLAProfile | null> {
    return locked(this.state, async () => {
      const store = await readAnalyticsStore(this.state.deps.storePath);
      const idx = store.slaProfiles.findIndex((p) => p.id === id);
      if (idx === -1) {
        return null;
      }

      const profile = store.slaProfiles[idx]!;

      if (patch.name !== undefined) {
        profile.name = patch.name;
      }
      if (patch.targetResponseMs !== undefined) {
        profile.targetResponseMs = patch.targetResponseMs;
      }
      if (patch.escalateAfterMs !== undefined) {
        profile.escalateAfterMs = patch.escalateAfterMs;
      }
      if (patch.entityIds !== undefined) {
        profile.entityIds = patch.entityIds;
      }

      store.slaProfiles[idx] = profile;
      await writeAnalyticsStore(this.state.deps.storePath, store);

      this.emit("sla.profile.updated", profile);
      return profile;
    });
  }

  async deleteSLAProfile(id: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readAnalyticsStore(this.state.deps.storePath);
      const idx = store.slaProfiles.findIndex((p) => p.id === id);
      if (idx === -1) {
        return false;
      }

      store.slaProfiles.splice(idx, 1);
      await writeAnalyticsStore(this.state.deps.storePath, store);

      this.emit("sla.profile.deleted", { id });
      this.state.deps.log.info(`SLA profile deleted: ${id}`);
      return true;
    });
  }

  // =========================================================================
  // Response Time Tracking
  // =========================================================================

  async recordInbound(
    messageId: string,
    personId: string | undefined,
    receivedAtMs: number,
  ): Promise<ResponseTimeEntry> {
    return locked(this.state, async () => {
      const store = await readAnalyticsStore(this.state.deps.storePath);

      const entry: ResponseTimeEntry = {
        messageId,
        personId,
        receivedAtMs,
      };

      store.responseEntries.push(entry);
      await writeAnalyticsStore(this.state.deps.storePath, store);

      this.state.deps.log.info(`inbound recorded: ${messageId}`);
      return entry;
    });
  }

  async recordResponse(messageId: string, repliedAtMs: number): Promise<ResponseTimeEntry | null> {
    return locked(this.state, async () => {
      const store = await readAnalyticsStore(this.state.deps.storePath);
      const idx = store.responseEntries.findIndex((e) => e.messageId === messageId);
      if (idx === -1) {
        return null;
      }

      const entry = store.responseEntries[idx]!;
      entry.repliedAtMs = repliedAtMs;
      store.responseEntries[idx] = entry;

      await writeAnalyticsStore(this.state.deps.storePath, store);

      this.state.deps.log.info(`response recorded: ${messageId}`);
      return entry;
    });
  }

  // =========================================================================
  // SLA Status
  // =========================================================================

  async checkSLAStatus(entityId: string): Promise<SLAStatus | null> {
    const store = await readAnalyticsStore(this.state.deps.storePath);
    const now = this.now();

    // Find matching SLA profile
    const profile = store.slaProfiles.find((p) => p.entityIds.includes(entityId));
    if (!profile) {
      return null;
    }

    // Get all unresponded entries for this entity
    const pendingEntries = store.responseEntries.filter(
      (e) => e.personId === entityId && e.repliedAtMs === undefined,
    );

    // All entries for compliance calculation (responded + pending)
    const allEntries = store.responseEntries.filter((e) => e.personId === entityId);

    const pendingMessages = pendingEntries.map((entry) => {
      const elapsed = now - entry.receivedAtMs;
      const remaining = profile.targetResponseMs - elapsed;
      const breached = elapsed > profile.targetResponseMs;
      return {
        messageId: entry.messageId,
        receivedAtMs: entry.receivedAtMs,
        breached,
        remainingMs: Math.max(0, remaining),
      };
    });

    // Calculate compliance rate: ratio of on-time responses out of all entries
    let respondedOnTime = 0;
    for (const entry of allEntries) {
      if (entry.repliedAtMs !== undefined) {
        const elapsed = entry.repliedAtMs - entry.receivedAtMs;
        if (elapsed <= profile.targetResponseMs) {
          respondedOnTime++;
        }
      }
    }

    const complianceRate = allEntries.length > 0 ? respondedOnTime / allEntries.length : 1;

    return {
      personId: entityId,
      profileId: profile.id,
      pendingMessages,
      complianceRate,
    };
  }

  async getOverdueMessages(): Promise<ResponseTimeEntry[]> {
    const store = await readAnalyticsStore(this.state.deps.storePath);
    const now = this.now();

    return store.responseEntries.filter((entry) => {
      // Skip already responded
      if (entry.repliedAtMs !== undefined) {
        return false;
      }

      if (!entry.personId) {
        return false;
      }

      // Find matching SLA profile for this entry's person
      const profile = store.slaProfiles.find((p) => p.entityIds.includes(entry.personId!));
      if (!profile) {
        return false;
      }

      const elapsed = now - entry.receivedAtMs;
      return elapsed > profile.targetResponseMs;
    });
  }

  // =========================================================================
  // Analytics Aggregation
  // =========================================================================

  async getAnalytics(from: number, to: number): Promise<InboundAnalytics> {
    const store = await readAnalyticsStore(this.state.deps.storePath);

    // Fetch messages from the injected dependency if available
    const messages = this.state.deps.getInboundMessages
      ? await this.state.deps.getInboundMessages(from, to)
      : [];

    // Fetch triages for all messages
    const messageIds = messages.map((m) => m.id);
    const triages =
      this.state.deps.getTriages && messageIds.length > 0
        ? await this.state.deps.getTriages(messageIds)
        : [];

    // Build triage index
    const triageByMessageId = new Map(triages.map((t) => [t.messageId, t]));

    // Volume by platform
    const volumeByPlatform: Record<string, number> = {};
    for (const msg of messages) {
      const platform = msg.source.type;
      volumeByPlatform[platform] = (volumeByPlatform[platform] ?? 0) + 1;
    }

    // Volume by hour (24 slots, UTC)
    const volumeByHour = Array<number>(24).fill(0);
    for (const msg of messages) {
      const hour = new Date(msg.createdAtMs).getUTCHours();
      volumeByHour[hour]!++;
    }

    // Volume by day of week (7 slots, 0=Sunday)
    const volumeByDayOfWeek = Array<number>(7).fill(0);
    for (const msg of messages) {
      const day = new Date(msg.createdAtMs).getUTCDay();
      volumeByDayOfWeek[day]!++;
    }

    // Top contacts
    const contactCounts = new Map<string, { displayName: string; count: number }>();
    for (const msg of messages) {
      if (msg.personId) {
        const existing = contactCounts.get(msg.personId);
        if (existing) {
          existing.count++;
        } else {
          contactCounts.set(msg.personId, {
            displayName: msg.source.senderName ?? msg.personId,
            count: 1,
          });
        }
      }
    }
    const topContacts = [...contactCounts.entries()]
      .map(([personId, { displayName, count }]) => ({ personId, displayName, count }))
      .toSorted((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top topics from triages
    const topicCounts = new Map<string, number>();
    for (const triage of triages) {
      for (const topic of triage.topics) {
        topicCounts.set(topic.label, (topicCounts.get(topic.label) ?? 0) + 1);
      }
    }
    const topTopics = [...topicCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .toSorted((a, b) => b.count - a.count)
      .slice(0, 10);

    // Sentiment distribution
    const sentimentDistribution: Record<string, number> = {};
    for (const triage of triages) {
      const s = triage.sentiment;
      sentimentDistribution[s] = (sentimentDistribution[s] ?? 0) + 1;
    }

    // Response time: use response entries that fall within the period
    const periodEntries = store.responseEntries.filter(
      (e) => e.receivedAtMs >= from && e.receivedAtMs <= to && e.repliedAtMs !== undefined,
    );

    let responseTimeAvg = 0;
    const responseTimeByDay: Record<string, number> = {};

    if (periodEntries.length > 0) {
      const totalMs = periodEntries.reduce((sum, e) => sum + (e.repliedAtMs! - e.receivedAtMs), 0);
      responseTimeAvg = totalMs / periodEntries.length;

      // Group by ISO date
      const dayGroups = new Map<string, number[]>();
      for (const entry of periodEntries) {
        const isoDate = new Date(entry.receivedAtMs).toISOString().slice(0, 10);
        const group = dayGroups.get(isoDate) ?? [];
        group.push(entry.repliedAtMs! - entry.receivedAtMs);
        dayGroups.set(isoDate, group);
      }

      for (const [day, times] of dayGroups) {
        responseTimeByDay[day] = times.reduce((a, b) => a + b, 0) / times.length;
      }
    }

    this.emit("analytics.updated", { from, to });

    return {
      volumeByPlatform,
      volumeByHour,
      volumeByDayOfWeek,
      topContacts,
      topTopics,
      responseTimeAvg,
      responseTimeByDay,
      sentimentDistribution,
      periodMs: { from, to },
    };
  }
}

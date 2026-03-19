// ---------------------------------------------------------------------------
// TriageService – AI-powered message triage service
// ---------------------------------------------------------------------------
// Follows the PeopleService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import type { SentimentSnapshot } from "../people/types.js";
import type { MessageTriage, TopicTag } from "./types.js";
import { readTriageStore, writeTriageStore } from "./store.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TriageContext = {
  messageBody: string;
  senderName?: string;
  personContext?: { tags: string[]; sentiment?: SentimentSnapshot; org?: string };
  vaultNotes?: string[];
  recentHistory?: string[];
};

export type AITriageResult = {
  priorityScore: number;
  priorityFactors: import("./types.js").PriorityFactor[];
  topics: TopicTag[];
  sentiment: import("./types.js").TriageSentiment;
  suggestedAction?: import("./types.js").TriageSuggestedAction;
  autoDraft?: string;
};

export type TriageServiceDeps = {
  storePath: string;
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  broadcast: (event: string, payload: unknown) => void;
  nowMs?: () => number;
  runAITriage?: (context: TriageContext) => Promise<AITriageResult>;
};

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

type ServiceState = {
  deps: TriageServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: TriageServiceDeps): ServiceState {
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
// TriageService
// ---------------------------------------------------------------------------

export class TriageService {
  private readonly state: ServiceState;

  constructor(deps: TriageServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  // =========================================================================
  // triageMessage
  // =========================================================================

  async triageMessage(messageId: string, context: TriageContext): Promise<MessageTriage> {
    return locked(this.state, async () => {
      const store = await readTriageStore(this.state.deps.storePath);

      let aiResult: AITriageResult | null = null;

      if (this.state.deps.runAITriage) {
        try {
          aiResult = await this.state.deps.runAITriage(context);
        } catch (err) {
          this.state.deps.log.warn(`AI triage failed for message ${messageId}: ${String(err)}`);
        }
      }

      const triage: MessageTriage = {
        messageId,
        priorityScore: aiResult?.priorityScore ?? 50,
        priorityFactors: aiResult?.priorityFactors ?? [],
        topics: aiResult?.topics ?? [],
        sentiment: aiResult?.sentiment ?? "neutral",
        suggestedAction: aiResult?.suggestedAction,
        autoDraft: aiResult?.autoDraft,
        processedAtMs: this.now(),
      };

      // Replace existing or append
      const idx = store.triages.findIndex((t) => t.messageId === messageId);
      if (idx !== -1) {
        store.triages[idx] = triage;
      } else {
        store.triages.push(triage);
      }

      await writeTriageStore(this.state.deps.storePath, store);

      this.emit("triage.completed", triage);
      this.state.deps.log.info(`triage completed: ${messageId}`);
      return triage;
    });
  }

  // =========================================================================
  // getTriageForMessage
  // =========================================================================

  async getTriageForMessage(messageId: string): Promise<MessageTriage | null> {
    const store = await readTriageStore(this.state.deps.storePath);
    return store.triages.find((t) => t.messageId === messageId) ?? null;
  }

  // =========================================================================
  // bulkTriage
  // =========================================================================

  async bulkTriage(
    items: Array<{ messageId: string; context: TriageContext }>,
  ): Promise<MessageTriage[]> {
    const results: MessageTriage[] = [];
    for (const item of items) {
      const result = await this.triageMessage(item.messageId, item.context);
      results.push(result);
    }
    return results;
  }

  // =========================================================================
  // addManualTag
  // =========================================================================

  async addManualTag(messageId: string, label: string): Promise<MessageTriage | null> {
    return locked(this.state, async () => {
      const store = await readTriageStore(this.state.deps.storePath);
      const idx = store.triages.findIndex((t) => t.messageId === messageId);
      if (idx === -1) {
        return null;
      }

      const triage = store.triages[idx]!;

      // No duplicate labels
      const alreadyExists = triage.topics.some((t) => t.label === label);
      if (!alreadyExists) {
        const tag: TopicTag = { label, confidence: 1, source: "manual" };
        triage.topics.push(tag);
        store.triages[idx] = triage;
        await writeTriageStore(this.state.deps.storePath, store);
        this.emit("triage.tag.added", { messageId, label });
      }

      return triage;
    });
  }

  // =========================================================================
  // removeTag
  // =========================================================================

  async removeTag(messageId: string, label: string): Promise<MessageTriage | null> {
    return locked(this.state, async () => {
      const store = await readTriageStore(this.state.deps.storePath);
      const idx = store.triages.findIndex((t) => t.messageId === messageId);
      if (idx === -1) {
        return null;
      }

      const triage = store.triages[idx]!;
      const tagIdx = triage.topics.findIndex((t) => t.label === label);
      if (tagIdx !== -1) {
        triage.topics.splice(tagIdx, 1);
        store.triages[idx] = triage;
        await writeTriageStore(this.state.deps.storePath, store);
        this.emit("triage.tag.removed", { messageId, label });
      }

      return triage;
    });
  }

  // =========================================================================
  // regenerateDraft
  // =========================================================================

  async regenerateDraft(messageId: string, context: TriageContext): Promise<MessageTriage | null> {
    return locked(this.state, async () => {
      const store = await readTriageStore(this.state.deps.storePath);
      const idx = store.triages.findIndex((t) => t.messageId === messageId);
      if (idx === -1) {
        return null;
      }

      const triage = store.triages[idx]!;

      if (this.state.deps.runAITriage) {
        try {
          const aiResult = await this.state.deps.runAITriage(context);
          triage.autoDraft = aiResult.autoDraft;
          // autoDraftModel is not part of AITriageResult — set if present on result
          if ("autoDraftModel" in aiResult) {
            triage.autoDraftModel = (aiResult as { autoDraftModel?: string }).autoDraftModel;
          }
        } catch (err) {
          this.state.deps.log.warn(
            `AI draft regeneration failed for message ${messageId}: ${String(err)}`,
          );
        }
      }

      store.triages[idx] = triage;
      await writeTriageStore(this.state.deps.storePath, store);

      return triage;
    });
  }
}

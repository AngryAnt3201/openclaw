// ---------------------------------------------------------------------------
// WorkflowService – Core workflow management service
// ---------------------------------------------------------------------------
// Follows the TaskService pattern: dependency-injected, event-driven,
// file-backed, with promise-based locking for safe concurrent access.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  Workflow,
  WorkflowCreateInput,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowFilter,
  WorkflowPatch,
  WorkflowPolicies,
  WorkflowStatus,
  WorkflowStep,
  StepPatch,
  StepStatus,
  VALID_WORKFLOW_TRANSITIONS,
  VALID_STEP_TRANSITIONS,
} from "./types.js";
import { resolveRepoContext, getCurrentBranch } from "./github.js";
import {
  appendWorkflowEvent,
  readWorkflowEvents,
  readWorkflowPolicies,
  readWorkflowStore,
  writeWorkflowPolicies,
  writeWorkflowStore,
} from "./store.js";

// ---------------------------------------------------------------------------
// Dependencies (injected at construction)
// ---------------------------------------------------------------------------

export type WorkflowServiceDeps = {
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
  deps: WorkflowServiceDeps;
  op: Promise<unknown>;
};

function createServiceState(deps: WorkflowServiceDeps): ServiceState {
  return { deps, op: Promise.resolve() };
}

// ---------------------------------------------------------------------------
// Serialised lock (same pattern as task service)
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
// Slug generation
// ---------------------------------------------------------------------------

function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// WorkflowService
// ---------------------------------------------------------------------------

export class WorkflowService {
  private readonly state: ServiceState;

  constructor(deps: WorkflowServiceDeps) {
    this.state = createServiceState(deps);
  }

  private now(): number {
    return this.state.deps.nowMs?.() ?? Date.now();
  }

  private emit(event: string, payload: unknown): void {
    this.state.deps.broadcast(event, payload);
  }

  private makeEvent(
    workflowId: string,
    type: WorkflowEventType,
    message: string,
    data?: Record<string, unknown>,
    stepId?: string,
  ): WorkflowEvent {
    return {
      id: randomUUID(),
      workflowId,
      stepId,
      type,
      timestamp: this.now(),
      message,
      data,
    };
  }

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(input: WorkflowCreateInput): Promise<Workflow> {
    return locked(this.state, async () => {
      const store = await readWorkflowStore(this.state.deps.storePath);
      const now = this.now();

      // Resolve repo context
      const repo = await resolveRepoContext(input.repoPath);
      const baseBranch = input.baseBranch ?? (await getCurrentBranch(input.repoPath));

      // Generate branch name
      const slug = slugify(input.title);
      const prefix = input.branchPrefix ?? "feat/";
      const workBranch = input.branchName ?? `${prefix}${slug}-${randomUUID().slice(0, 8)}`;

      // Build steps from input
      const steps: WorkflowStep[] = (input.steps ?? []).map((s, i) => ({
        id: randomUUID(),
        index: i,
        title: s.title,
        description: s.description,
        status: "pending" as StepStatus,
        sessionMode: s.sessionMode ?? input.sessionMode ?? "Claude",
        dependsOn: (s.dependsOn ?? []).map((depIdx) => {
          // Map input indices to step IDs — we assign IDs in order above
          // so we can reference earlier steps. For forward-refs this will
          // resolve to "" which the engine treats as "no dep".
          return "";
        }),
        commitsBefore: [],
        commitsAfter: [],
        filesChanged: [],
        tokenUsage: 0,
        toolCalls: 0,
      }));

      // Resolve dependsOn from indices to IDs
      if (input.steps) {
        for (let i = 0; i < input.steps.length; i++) {
          const deps = input.steps[i]!.dependsOn ?? [];
          steps[i]!.dependsOn = deps
            .filter((idx) => idx >= 0 && idx < steps.length)
            .map((idx) => steps[idx]!.id);
        }
      }

      const workflow: Workflow = {
        id: randomUUID(),
        title: input.title,
        description: input.description,
        status: steps.length > 0 ? "running" : "planning",
        trigger: input.trigger,
        taskId: input.taskId,
        issueNumber: input.issueNumber,
        repo,
        baseBranch,
        workBranch,
        steps,
        currentStepIndex: 0,
        createdAtMs: now,
        updatedAtMs: now,
        startedAtMs: steps.length > 0 ? now : undefined,
        totalTokens: 0,
        totalCost: 0,
        totalToolCalls: 0,
      };

      store.workflows.push(workflow);
      await writeWorkflowStore(this.state.deps.storePath, store);

      const event = this.makeEvent(
        workflow.id,
        "status_change",
        `Workflow created: ${workflow.title}`,
        { status: workflow.status },
      );
      await appendWorkflowEvent(this.state.deps.storePath, event);

      this.emit("workflow.created", workflow);
      this.state.deps.log.info(`workflow created: ${workflow.id} — ${workflow.title}`);

      return workflow;
    });
  }

  // -------------------------------------------------------------------------
  // get / list
  // -------------------------------------------------------------------------

  async get(workflowId: string): Promise<Workflow | null> {
    const store = await readWorkflowStore(this.state.deps.storePath);
    return store.workflows.find((w) => w.id === workflowId) ?? null;
  }

  async list(filter?: WorkflowFilter): Promise<Workflow[]> {
    const store = await readWorkflowStore(this.state.deps.storePath);
    let workflows = store.workflows;

    if (filter) {
      if (filter.status?.length) {
        const statusSet = new Set<WorkflowStatus>(filter.status);
        workflows = workflows.filter((w) => statusSet.has(w.status));
      }
      if (filter.trigger?.length) {
        const triggerSet = new Set(filter.trigger);
        workflows = workflows.filter((w) => triggerSet.has(w.trigger));
      }
      if (filter.repo) {
        const repoName = filter.repo.toLowerCase();
        workflows = workflows.filter(
          (w) =>
            w.repo.name.toLowerCase() === repoName ||
            `${w.repo.owner}/${w.repo.name}`.toLowerCase() === repoName,
        );
      }
      if (filter.limit && filter.limit > 0) {
        workflows = workflows.slice(0, filter.limit);
      }
    }

    return workflows;
  }

  // -------------------------------------------------------------------------
  // updateWorkflow (internal — used by engine and handlers)
  // -------------------------------------------------------------------------

  async updateWorkflow(workflowId: string, patch: WorkflowPatch): Promise<Workflow | null> {
    return locked(this.state, async () => {
      const store = await readWorkflowStore(this.state.deps.storePath);
      const idx = store.workflows.findIndex((w) => w.id === workflowId);
      if (idx === -1) {
        return null;
      }

      const wf = store.workflows[idx]!;
      const prevStatus = wf.status;

      if (patch.title !== undefined) {
        wf.title = patch.title;
      }
      if (patch.description !== undefined) {
        wf.description = patch.description;
      }
      if (patch.status !== undefined) {
        wf.status = patch.status;
      }
      if (patch.currentStepIndex !== undefined) {
        wf.currentStepIndex = patch.currentStepIndex;
      }
      if (patch.pullRequest !== undefined) {
        wf.pullRequest = patch.pullRequest;
      }
      if (patch.review !== undefined) {
        wf.review = patch.review;
      }
      if (patch.startedAtMs !== undefined) {
        wf.startedAtMs = patch.startedAtMs;
      }
      if (patch.completedAtMs !== undefined) {
        wf.completedAtMs = patch.completedAtMs;
      }
      if (patch.totalTokens !== undefined) {
        wf.totalTokens = patch.totalTokens;
      }
      if (patch.totalCost !== undefined) {
        wf.totalCost = patch.totalCost;
      }
      if (patch.totalToolCalls !== undefined) {
        wf.totalToolCalls = patch.totalToolCalls;
      }
      wf.updatedAtMs = this.now();

      store.workflows[idx] = wf;
      await writeWorkflowStore(this.state.deps.storePath, store);

      if (patch.status && patch.status !== prevStatus) {
        const event = this.makeEvent(
          wf.id,
          "status_change",
          `Status: ${prevStatus} → ${patch.status}`,
          { from: prevStatus, to: patch.status },
        );
        await appendWorkflowEvent(this.state.deps.storePath, event);
      }

      this.emit("workflow.updated", wf);

      if (patch.status === "merged") {
        this.emit("workflow.merged", wf);
      } else if (patch.status === "failed") {
        this.emit("workflow.failed", wf);
      }

      return wf;
    });
  }

  // -------------------------------------------------------------------------
  // updateStep (internal — used by engine)
  // -------------------------------------------------------------------------

  async updateStep(workflowId: string, stepId: string, patch: StepPatch): Promise<Workflow | null> {
    return locked(this.state, async () => {
      const store = await readWorkflowStore(this.state.deps.storePath);
      const wfIdx = store.workflows.findIndex((w) => w.id === workflowId);
      if (wfIdx === -1) {
        return null;
      }

      const wf = store.workflows[wfIdx]!;
      const step = wf.steps.find((s) => s.id === stepId);
      if (!step) {
        return null;
      }

      const prevStatus = step.status;

      if (patch.status !== undefined) {
        step.status = patch.status;
      }
      if (patch.sessionId !== undefined) {
        step.sessionId = patch.sessionId;
      }
      if (patch.result !== undefined) {
        step.result = patch.result;
      }
      if (patch.error !== undefined) {
        step.error = patch.error;
      }
      if (patch.tokenUsage !== undefined) {
        step.tokenUsage = patch.tokenUsage;
      }
      if (patch.toolCalls !== undefined) {
        step.toolCalls = patch.toolCalls;
      }
      if (patch.commitsBefore !== undefined) {
        step.commitsBefore = patch.commitsBefore;
      }
      if (patch.commitsAfter !== undefined) {
        step.commitsAfter = patch.commitsAfter;
      }
      if (patch.filesChanged !== undefined) {
        step.filesChanged = patch.filesChanged;
      }
      if (patch.startedAtMs !== undefined) {
        step.startedAtMs = patch.startedAtMs;
      }
      if (patch.completedAtMs !== undefined) {
        step.completedAtMs = patch.completedAtMs;
      }

      wf.updatedAtMs = this.now();
      store.workflows[wfIdx] = wf;
      await writeWorkflowStore(this.state.deps.storePath, store);

      if (patch.status && patch.status !== prevStatus) {
        const eventType: WorkflowEventType =
          patch.status === "running"
            ? "step_started"
            : patch.status === "complete"
              ? "step_completed"
              : patch.status === "failed"
                ? "step_failed"
                : patch.status === "skipped"
                  ? "step_skipped"
                  : "info";

        const event = this.makeEvent(
          wf.id,
          eventType,
          `Step "${step.title}": ${prevStatus} → ${patch.status}`,
          { stepId, from: prevStatus, to: patch.status },
          stepId,
        );
        await appendWorkflowEvent(this.state.deps.storePath, event);
      }

      this.emit("workflow.updated", wf);
      return wf;
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle: pause, resume, cancel, retryStep
  // -------------------------------------------------------------------------

  async pause(workflowId: string): Promise<Workflow | null> {
    return this.updateWorkflow(workflowId, { status: "paused" });
  }

  async resume(workflowId: string): Promise<Workflow | null> {
    return this.updateWorkflow(workflowId, { status: "running" });
  }

  async cancel(workflowId: string): Promise<Workflow | null> {
    return locked(this.state, async () => {
      const store = await readWorkflowStore(this.state.deps.storePath);
      const idx = store.workflows.findIndex((w) => w.id === workflowId);
      if (idx === -1) {
        return null;
      }

      const wf = store.workflows[idx]!;
      wf.status = "cancelled";
      wf.completedAtMs = this.now();
      wf.updatedAtMs = this.now();

      // Cancel running steps
      for (const step of wf.steps) {
        if (step.status === "running" || step.status === "pending") {
          step.status = "skipped";
        }
      }

      store.workflows[idx] = wf;
      await writeWorkflowStore(this.state.deps.storePath, store);

      const event = this.makeEvent(wf.id, "status_change", "Workflow cancelled");
      await appendWorkflowEvent(this.state.deps.storePath, event);

      this.emit("workflow.updated", wf);
      this.emit("workflow.cancelled", wf);
      this.state.deps.log.info(`workflow cancelled: ${wf.id}`);

      return wf;
    });
  }

  async retryStep(workflowId: string, stepId: string): Promise<Workflow | null> {
    return locked(this.state, async () => {
      const store = await readWorkflowStore(this.state.deps.storePath);
      const wfIdx = store.workflows.findIndex((w) => w.id === workflowId);
      if (wfIdx === -1) {
        return null;
      }

      const wf = store.workflows[wfIdx]!;
      const step = wf.steps.find((s) => s.id === stepId);
      if (!step || step.status !== "failed") {
        return null;
      }

      step.status = "pending";
      step.error = undefined;
      step.sessionId = undefined;
      step.startedAtMs = undefined;
      step.completedAtMs = undefined;

      // Ensure workflow is in running state
      if (wf.status === "failed") {
        wf.status = "running";
      }
      wf.updatedAtMs = this.now();

      store.workflows[wfIdx] = wf;
      await writeWorkflowStore(this.state.deps.storePath, store);

      const event = this.makeEvent(
        wf.id,
        "info",
        `Retrying step "${step.title}"`,
        { stepId },
        stepId,
      );
      await appendWorkflowEvent(this.state.deps.storePath, event);

      this.emit("workflow.updated", wf);
      return wf;
    });
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(workflowId: string): Promise<boolean> {
    return locked(this.state, async () => {
      const store = await readWorkflowStore(this.state.deps.storePath);
      const idx = store.workflows.findIndex((w) => w.id === workflowId);
      if (idx === -1) {
        return false;
      }

      store.workflows.splice(idx, 1);
      await writeWorkflowStore(this.state.deps.storePath, store);

      this.emit("workflow.deleted", { workflowId });
      this.state.deps.log.info(`workflow deleted: ${workflowId}`);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // addEvent / getEvents
  // -------------------------------------------------------------------------

  async addEvent(
    workflowId: string,
    type: WorkflowEventType,
    message: string,
    data?: Record<string, unknown>,
    stepId?: string,
  ): Promise<WorkflowEvent> {
    const event = this.makeEvent(workflowId, type, message, data, stepId);
    await appendWorkflowEvent(this.state.deps.storePath, event);
    this.emit("workflow.event", event);
    return event;
  }

  async getEvents(workflowId: string, limit?: number): Promise<WorkflowEvent[]> {
    return readWorkflowEvents(this.state.deps.storePath, workflowId, { limit });
  }

  // -------------------------------------------------------------------------
  // Policies
  // -------------------------------------------------------------------------

  async getPolicies(): Promise<WorkflowPolicies> {
    return readWorkflowPolicies(this.state.deps.storePath);
  }

  async updatePolicies(patch: Partial<WorkflowPolicies>): Promise<WorkflowPolicies> {
    const current = await readWorkflowPolicies(this.state.deps.storePath);
    const merged: WorkflowPolicies = {
      branchPrefixes: { ...current.branchPrefixes, ...patch.branchPrefixes },
      pr: { ...current.pr, ...patch.pr },
      sessions: { ...current.sessions, ...patch.sessions },
      commits: { ...current.commits, ...patch.commits },
      safety: { ...current.safety, ...patch.safety },
    };
    await writeWorkflowPolicies(this.state.deps.storePath, merged);
    this.emit("workflow.policies.updated", merged);
    return merged;
  }
}

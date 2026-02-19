// ---------------------------------------------------------------------------
// Workflow Execution Engine – Background scheduler for workflow orchestration
// ---------------------------------------------------------------------------
// Monitors running workflows, resolves step dependencies, spawns sessions,
// polls for completion, creates PRs, and triggers reviews.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type { CredentialService } from "../credentials/service.js";
import type { WorkflowService } from "./service.js";
import type { Workflow, WorkflowPolicies, WorkflowStep, StepStatus, FileChange } from "./types.js";
import * as github from "./github.js";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type WorkflowEngineDeps = {
  workflowService: WorkflowService;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  /** Spawn a session via callGateway("agent", ...). Returns runId. */
  spawnSession: (params: {
    sessionKey: string;
    message: string;
    cwd?: string;
    label?: string;
    extraSystemPrompt?: string;
  }) => Promise<{ runId: string }>;
  /** Check if a session run is complete. Returns null if still running. */
  checkSessionStatus: (runId: string) => Promise<{
    done: boolean;
    success?: boolean;
    output?: string;
    tokensUsed?: number;
    toolCalls?: number;
  }>;
  broadcast: (event: string, payload: unknown) => void;
  credentialService?: CredentialService;
  nowMs?: () => number;
};

// ---------------------------------------------------------------------------
// Active session tracking
// ---------------------------------------------------------------------------

export type ActiveSession = {
  workflowId: string;
  stepId: string;
  sessionKey: string;
  runId: string;
  startedAtMs: number;
  pollIntervalMs: number;
  timeoutMs: number;
  lastPollMs: number;
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 5_000;
const MIN_POLL_INTERVAL_MS = 5_000;
const MAX_POLL_INTERVAL_MS = 30_000;
const POLL_BACKOFF_FACTOR = 1.5;

export class WorkflowEngine {
  private readonly deps: WorkflowEngineDeps;
  private readonly activeSessions = new Map<string, ActiveSession>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(deps: WorkflowEngineDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.nowMs?.() ?? Date.now();
  }

  // -------------------------------------------------------------------------
  // Start / Stop
  // -------------------------------------------------------------------------

  start(): void {
    if (this.tickTimer) {
      return;
    }
    this.tickTimer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.deps.log.info("workflow engine started");
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.deps.log.info("workflow engine stopped");
  }

  // -------------------------------------------------------------------------
  // Main tick
  // -------------------------------------------------------------------------

  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      // Poll active sessions
      await this.pollActiveSessions();

      // Find running workflows and schedule ready steps
      const workflows = await this.deps.workflowService.list({
        status: ["running"],
      });
      const policies = await this.deps.workflowService.getPolicies();

      for (const wf of workflows) {
        await this.processWorkflow(wf, policies);
      }
    } catch (err) {
      this.deps.log.error(`engine tick error: ${String(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  // -------------------------------------------------------------------------
  // Process a single workflow
  // -------------------------------------------------------------------------

  private async processWorkflow(wf: Workflow, policies: WorkflowPolicies): Promise<void> {
    const readySteps = this.findReadySteps(wf);

    if (readySteps.length === 0) {
      // Check if all steps are done
      const allDone = wf.steps.every((s) => s.status === "complete" || s.status === "skipped");
      const anyFailed = wf.steps.some((s) => s.status === "failed");

      if (allDone && wf.steps.length > 0) {
        await this.handleAllStepsComplete(wf, policies);
      } else if (anyFailed && !wf.steps.some((s) => s.status === "running")) {
        // All running steps done but some failed and nothing is pending/ready
        const pendingCount = wf.steps.filter((s) => s.status === "pending").length;
        if (pendingCount === 0 || this.findReadySteps(wf).length === 0) {
          await this.deps.workflowService.updateWorkflow(wf.id, {
            status: "failed",
            completedAtMs: this.now(),
          });
          await this.deps.workflowService.addEvent(
            wf.id,
            "error",
            "Workflow failed: one or more steps failed",
          );
        }
      }
      return;
    }

    // Respect concurrency limits
    const runningCount = this.countActiveSessions(wf.id);
    const maxConcurrent = policies.sessions.maxConcurrent;
    const slotsAvailable = Math.max(0, maxConcurrent - runningCount);

    if (slotsAvailable === 0) {
      return;
    }

    const toSpawn = readySteps.slice(0, slotsAvailable);
    for (const step of toSpawn) {
      await this.spawnStepSession(wf, step, policies);
    }
  }

  // -------------------------------------------------------------------------
  // Dependency resolution
  // -------------------------------------------------------------------------

  findReadySteps(wf: Workflow): WorkflowStep[] {
    return wf.steps.filter((step) => {
      if (step.status !== "pending") {
        return false;
      }
      // Already has an active session
      if (this.activeSessions.has(step.id)) {
        return false;
      }
      // Check all dependencies are complete or skipped
      return step.dependsOn.every((depId) => {
        const dep = wf.steps.find((s) => s.id === depId);
        return dep && (dep.status === "complete" || dep.status === "skipped");
      });
    });
  }

  // -------------------------------------------------------------------------
  // Session spawning
  // -------------------------------------------------------------------------

  private async spawnStepSession(
    wf: Workflow,
    step: WorkflowStep,
    policies: WorkflowPolicies,
  ): Promise<void> {
    try {
      const now = this.now();

      // Mark step as running
      await this.deps.workflowService.updateStep(wf.id, step.id, {
        status: "running",
        startedAtMs: now,
      });

      // Capture commits before
      let commitsBefore: string[] = [];
      try {
        commitsBefore = await github.getCommitLog(wf.repo.path, wf.baseBranch, wf.workBranch);
      } catch {
        // Branch may not exist yet
      }
      await this.deps.workflowService.updateStep(wf.id, step.id, {
        commitsBefore,
      });

      // Provision credentials for this step
      const credentialInfo = await this.provisionStepCredentials(wf, step);

      // Build session prompt
      const prompt = this.buildStepPrompt(wf, step, policies, credentialInfo);
      const sessionKey = `agent:default:workflow:${wf.id}:step:${step.id}`;

      const systemPrompt = [
        `You are executing step ${step.index + 1} of workflow "${wf.title}".`,
        `Working branch: ${wf.workBranch} (base: ${wf.baseBranch})`,
        `Repository: ${wf.repo.owner}/${wf.repo.name} at ${wf.repo.path}`,
        "",
        "Commit your changes when done. Use conventional commits if possible.",
        "Do NOT push the branch — the workflow engine handles pushing.",
      ].join("\n");

      const { runId } = await this.deps.spawnSession({
        sessionKey,
        message: prompt,
        cwd: wf.repo.path,
        label: `Workflow: ${wf.title} — Step ${step.index + 1}: ${step.title}`,
        extraSystemPrompt: systemPrompt,
      });

      // Track the active session
      this.activeSessions.set(step.id, {
        workflowId: wf.id,
        stepId: step.id,
        sessionKey,
        runId,
        startedAtMs: now,
        pollIntervalMs: MIN_POLL_INTERVAL_MS,
        timeoutMs: policies.sessions.timeoutMs,
        lastPollMs: now,
      });

      await this.deps.workflowService.addEvent(
        wf.id,
        "session_spawned",
        `Session spawned for step "${step.title}"`,
        { stepId: step.id, runId, sessionKey },
        step.id,
      );

      this.deps.log.info(
        `spawned session for workflow ${wf.id} step ${step.index + 1}: ${step.title}`,
      );
    } catch (err) {
      this.deps.log.error(`failed to spawn session for step "${step.title}": ${String(err)}`);
      await this.deps.workflowService.updateStep(wf.id, step.id, {
        status: "failed",
        error: String(err),
        completedAtMs: this.now(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step prompt construction
  // -------------------------------------------------------------------------

  private async provisionStepCredentials(wf: Workflow, step: WorkflowStep): Promise<string[]> {
    const credService = this.deps.credentialService;
    if (!credService || !step.requiredCredentials?.length) {
      return [];
    }

    const provisioned: string[] = [];
    const taskId = `workflow:${wf.id}:step:${step.id}`;

    for (const req of step.requiredCredentials) {
      try {
        const lease = await credService.createLease({
          credentialId: req.credentialId,
          taskId,
          agentId: `workflow:${wf.id}`,
        });
        if (lease) {
          provisioned.push(`${req.purpose} (${req.credentialId})`);
          this.deps.log.info(
            `provisioned credential ${req.credentialId} for workflow step ${step.title}`,
          );
        }
      } catch (err) {
        if (req.required) {
          throw new Error(
            `required credential ${req.credentialId} (${req.purpose}) not available: ${String(err)}`,
            { cause: err },
          );
        }
        this.deps.log.warn(`optional credential ${req.credentialId} not available: ${String(err)}`);
      }
    }

    return provisioned;
  }

  private buildStepPrompt(
    wf: Workflow,
    step: WorkflowStep,
    _policies: WorkflowPolicies,
    credentialInfo: string[] = [],
  ): string {
    const lines: string[] = [];

    lines.push(`# Step ${step.index + 1}: ${step.title}`);
    lines.push("");
    lines.push(step.description);
    lines.push("");

    // Add context from completed dependency steps
    if (step.dependsOn.length > 0) {
      lines.push("## Previous step results:");
      for (const depId of step.dependsOn) {
        const dep = wf.steps.find((s) => s.id === depId);
        if (dep?.result) {
          lines.push(`- Step ${dep.index + 1} (${dep.title}): ${dep.result}`);
        }
      }
      lines.push("");
    }

    // Add available credentials
    if (credentialInfo.length > 0) {
      lines.push("## Available Credentials:");
      for (const info of credentialInfo) {
        lines.push(`- ${info}`);
      }
      lines.push("");
    }

    // Add workflow context
    lines.push("## Workflow context:");
    lines.push(`- Title: ${wf.title}`);
    lines.push(`- Description: ${wf.description}`);
    if (wf.issueNumber) {
      lines.push(`- Related issue: #${wf.issueNumber}`);
    }

    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Session polling
  // -------------------------------------------------------------------------

  private async pollActiveSessions(): Promise<void> {
    const now = this.now();
    const completed: string[] = [];

    for (const [stepId, session] of this.activeSessions) {
      // Check timeout
      if (now - session.startedAtMs > session.timeoutMs) {
        this.deps.log.warn(
          `session timed out for step ${stepId} in workflow ${session.workflowId}`,
        );
        await this.handleSessionTimeout(session);
        completed.push(stepId);
        continue;
      }

      // Respect poll interval with backoff
      if (now - session.lastPollMs < session.pollIntervalMs) {
        continue;
      }
      session.lastPollMs = now;

      try {
        const status = await this.deps.checkSessionStatus(session.runId);
        if (!status.done) {
          // Increase poll interval with backoff
          session.pollIntervalMs = Math.min(
            session.pollIntervalMs * POLL_BACKOFF_FACTOR,
            MAX_POLL_INTERVAL_MS,
          );
          continue;
        }

        if (status.success) {
          await this.handleSessionComplete(session, status);
        } else {
          await this.handleSessionFailed(session, status.output ?? "Session failed");
        }
        completed.push(stepId);
      } catch (err) {
        this.deps.log.error(`error polling session for step ${stepId}: ${String(err)}`);
      }
    }

    for (const stepId of completed) {
      this.activeSessions.delete(stepId);
    }
  }

  // -------------------------------------------------------------------------
  // Session completion handlers
  // -------------------------------------------------------------------------

  private async handleSessionComplete(
    session: ActiveSession,
    status: {
      output?: string;
      tokensUsed?: number;
      toolCalls?: number;
    },
  ): Promise<void> {
    const now = this.now();

    // Capture commits after
    let commitsAfter: string[] = [];
    let filesChanged: FileChange[] = [];
    try {
      const wf = await this.deps.workflowService.get(session.workflowId);
      if (wf) {
        commitsAfter = await github.getCommitLog(wf.repo.path, wf.baseBranch, wf.workBranch);
        filesChanged = await github.getDiffStat(wf.repo.path, wf.baseBranch, wf.workBranch);
      }
    } catch {
      // Non-fatal: git operations may fail if no commits were made
    }

    await this.deps.workflowService.updateStep(session.workflowId, session.stepId, {
      status: "complete",
      result: status.output,
      tokenUsage: status.tokensUsed ?? 0,
      toolCalls: status.toolCalls ?? 0,
      commitsAfter,
      filesChanged,
      completedAtMs: now,
    });

    await this.deps.workflowService.addEvent(
      session.workflowId,
      "session_completed",
      `Session completed for step`,
      {
        stepId: session.stepId,
        runId: session.runId,
        tokensUsed: status.tokensUsed,
      },
      session.stepId,
    );

    // Accumulate budget
    const wf = await this.deps.workflowService.get(session.workflowId);
    if (wf) {
      await this.deps.workflowService.updateWorkflow(session.workflowId, {
        totalTokens: wf.totalTokens + (status.tokensUsed ?? 0),
        totalToolCalls: wf.totalToolCalls + (status.toolCalls ?? 0),
      });
    }

    this.deps.log.info(`step completed for workflow ${session.workflowId}`);
  }

  private async handleSessionFailed(session: ActiveSession, error: string): Promise<void> {
    await this.deps.workflowService.updateStep(session.workflowId, session.stepId, {
      status: "failed",
      error,
      completedAtMs: this.now(),
    });

    await this.deps.workflowService.addEvent(
      session.workflowId,
      "step_failed",
      `Step failed: ${error}`,
      { stepId: session.stepId, error },
      session.stepId,
    );

    this.deps.log.warn(`step failed for workflow ${session.workflowId}: ${error}`);
  }

  private async handleSessionTimeout(session: ActiveSession): Promise<void> {
    await this.deps.workflowService.updateStep(session.workflowId, session.stepId, {
      status: "failed",
      error: "Session timed out",
      completedAtMs: this.now(),
    });

    await this.deps.workflowService.addEvent(
      session.workflowId,
      "session_timeout",
      "Session timed out",
      { stepId: session.stepId, runId: session.runId },
      session.stepId,
    );
  }

  // -------------------------------------------------------------------------
  // All steps complete → push + PR
  // -------------------------------------------------------------------------

  private async handleAllStepsComplete(wf: Workflow, policies: WorkflowPolicies): Promise<void> {
    try {
      // Push the work branch
      await github.pushBranch(wf.repo.path, wf.workBranch);

      await this.deps.workflowService.addEvent(
        wf.id,
        "branch_pushed",
        `Pushed branch ${wf.workBranch}`,
      );

      // Build PR body
      const prBody = this.buildPRBody(wf);

      // Create draft PR
      const pr = await github.createPR({
        owner: wf.repo.owner,
        repo: wf.repo.name,
        title: wf.title,
        body: prBody,
        head: wf.workBranch,
        base: wf.baseBranch,
        draft: true,
        labels: policies.pr.labels.length > 0 ? policies.pr.labels : undefined,
        assignees: policies.pr.assignees.length > 0 ? policies.pr.assignees : undefined,
        linkedIssues: wf.issueNumber ? [wf.issueNumber] : undefined,
      });

      await this.deps.workflowService.updateWorkflow(wf.id, {
        status: "pr_open",
        pullRequest: pr,
        completedAtMs: this.now(),
      });

      await this.deps.workflowService.addEvent(
        wf.id,
        "pr_created",
        `Draft PR #${pr.number} created`,
        { prNumber: pr.number, prUrl: pr.url },
      );

      this.deps.broadcast("workflow.pr_created", {
        workflowId: wf.id,
        pr,
      });

      this.deps.log.info(`workflow ${wf.id} complete: PR #${pr.number} created`);
    } catch (err) {
      this.deps.log.error(`failed to create PR for workflow ${wf.id}: ${String(err)}`);
      await this.deps.workflowService.updateWorkflow(wf.id, {
        status: "failed",
        completedAtMs: this.now(),
      });
      await this.deps.workflowService.addEvent(
        wf.id,
        "error",
        `Failed to create PR: ${String(err)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // PR body generation
  // -------------------------------------------------------------------------

  private buildPRBody(wf: Workflow): string {
    const lines: string[] = [];

    lines.push("## Summary");
    lines.push("");
    lines.push(wf.description);
    lines.push("");

    if (wf.issueNumber) {
      lines.push(`Closes #${wf.issueNumber}`);
      lines.push("");
    }

    lines.push("## Steps Completed");
    lines.push("");
    for (const step of wf.steps) {
      const icon = step.status === "complete" ? "+" : step.status === "skipped" ? "-" : "x";
      lines.push(`- [${icon}] **Step ${step.index + 1}**: ${step.title}`);
      if (step.filesChanged.length > 0) {
        const filesSummary = step.filesChanged
          .slice(0, 10)
          .map((f) => `  - \`${f.path}\` (+${f.additions}/-${f.deletions})`)
          .join("\n");
        lines.push(filesSummary);
        if (step.filesChanged.length > 10) {
          lines.push(`  - ... and ${step.filesChanged.length - 10} more files`);
        }
      }
    }
    lines.push("");

    // Budget summary
    lines.push("## Budget");
    lines.push("");
    lines.push(`- Tokens: ${wf.totalTokens.toLocaleString()}`);
    lines.push(`- Tool calls: ${wf.totalToolCalls}`);
    lines.push(
      `- Steps: ${wf.steps.filter((s) => s.status === "complete").length}/${wf.steps.length}`,
    );
    lines.push("");
    lines.push("---");
    lines.push("*Generated by Miranda Workflow Engine*");

    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private countActiveSessions(workflowId: string): number {
    let count = 0;
    for (const session of this.activeSessions.values()) {
      if (session.workflowId === workflowId) {
        count++;
      }
    }
    return count;
  }

  /** Expose active sessions for testing/debugging. */
  getActiveSessions(): ReadonlyMap<string, ActiveSession> {
    return this.activeSessions;
  }
}

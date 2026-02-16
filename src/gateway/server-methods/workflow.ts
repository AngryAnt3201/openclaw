// ---------------------------------------------------------------------------
// Gateway RPC handlers for workflow.*, pr.*, issue.*, review.* methods
// ---------------------------------------------------------------------------

import type {
  WorkflowCreateInput,
  WorkflowFilter,
  PRCreateInput,
  PRUpdateInput,
  PRFilter,
  IssueCreateInput,
  IssueUpdateInput,
  IssueFilter,
} from "../../workflow/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import * as gh from "../../workflow/github.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

function requireNumber(params: Record<string, unknown>, key: string): number | null {
  const val = params[key];
  if (typeof val === "number" && Number.isFinite(val)) {
    return val;
  }
  return null;
}

function wakeAgentForWorkflow(message: string): void {
  enqueueSystemEvent(message, {});
  requestHeartbeatNow({ reason: "workflow" });
}

export const workflowHandlers: GatewayRequestHandlers = {
  // =========================================================================
  // WORKFLOW CRUD
  // =========================================================================

  "workflow.create": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const input = params as WorkflowCreateInput;
    if (!input.title || typeof input.title !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing title"));
      return;
    }
    if (!input.repoPath || typeof input.repoPath !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing repoPath"));
      return;
    }
    try {
      const workflow = await context.workflowService.create(input);
      // Wake agent on workflow creation
      wakeAgentForWorkflow(`New workflow created: "${workflow.title}" (${workflow.id})`);
      // Start engine processing if it has steps
      if (workflow.steps.length > 0 && context.workflowEngine) {
        void context.workflowEngine.tick();
      }
      respond(true, workflow, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "workflow.get": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const id = requireString(params, "id") ?? requireString(params, "workflowId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const workflow = await context.workflowService.get(id);
    if (!workflow) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workflow not found: ${id}`),
      );
      return;
    }
    respond(true, workflow, undefined);
  },

  "workflow.list": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const filter = (params ?? {}) as WorkflowFilter;
    const workflows = await context.workflowService.list(filter);
    respond(true, { workflows }, undefined);
  },

  "workflow.pause": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const id = requireString(params, "id") ?? requireString(params, "workflowId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const workflow = await context.workflowService.pause(id);
    if (!workflow) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workflow not found: ${id}`),
      );
      return;
    }
    respond(true, workflow, undefined);
  },

  "workflow.resume": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const id = requireString(params, "id") ?? requireString(params, "workflowId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const workflow = await context.workflowService.resume(id);
    if (!workflow) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workflow not found: ${id}`),
      );
      return;
    }
    // Trigger engine tick to pick up resumed workflow
    if (context.workflowEngine) {
      void context.workflowEngine.tick();
    }
    respond(true, workflow, undefined);
  },

  "workflow.cancel": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const id = requireString(params, "id") ?? requireString(params, "workflowId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const workflow = await context.workflowService.cancel(id);
    if (!workflow) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workflow not found: ${id}`),
      );
      return;
    }
    respond(true, workflow, undefined);
  },

  "workflow.retry_step": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const workflowId = requireString(params, "workflowId") ?? requireString(params, "id");
    const stepId = requireString(params, "stepId");
    if (!workflowId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing workflowId"));
      return;
    }
    if (!stepId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing stepId"));
      return;
    }
    const workflow = await context.workflowService.retryStep(workflowId, stepId);
    if (!workflow) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow or step not found"),
      );
      return;
    }
    if (context.workflowEngine) {
      void context.workflowEngine.tick();
    }
    respond(true, workflow, undefined);
  },

  "workflow.delete": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const id = requireString(params, "id") ?? requireString(params, "workflowId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const deleted = await context.workflowService.delete(id);
    if (!deleted) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workflow not found: ${id}`),
      );
      return;
    }
    respond(true, { workflowId: id }, undefined);
  },

  "workflow.events": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const id = requireString(params, "id") ?? requireString(params, "workflowId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const events = await context.workflowService.getEvents(id, limit);
    respond(true, { events }, undefined);
  },

  // =========================================================================
  // POLICIES
  // =========================================================================

  "workflow.policies.get": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const policies = await context.workflowService.getPolicies();
    respond(true, policies, undefined);
  },

  "workflow.policies.update": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const policies = await context.workflowService.updatePolicies(params);
    respond(true, policies, undefined);
  },

  // =========================================================================
  // PR OPERATIONS
  // =========================================================================

  "pr.create": async ({ params, respond }) => {
    const input = params as PRCreateInput;
    if (!input.owner || !input.repo || !input.title || !input.head || !input.base) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing required PR fields"),
      );
      return;
    }
    try {
      const pr = await gh.createPR(input);
      respond(true, pr, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "pr.get": async ({ params, respond }) => {
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    const number = requireNumber(params, "number");
    if (!owner || !repo || number === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing owner, repo, or number"),
      );
      return;
    }
    try {
      const pr = await gh.getPR(owner, repo, number);
      respond(true, pr, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "pr.list": async ({ params, respond }) => {
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    if (!owner || !repo) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing owner or repo"));
      return;
    }
    try {
      const filter = (params.filter ?? {}) as PRFilter;
      const prs = await gh.listPRs(owner, repo, filter);
      respond(true, { prs }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "pr.update": async ({ params, respond }) => {
    const input = params as PRUpdateInput;
    if (!input.owner || !input.repo || !input.number) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing required fields"));
      return;
    }
    try {
      const pr = await gh.updatePR(input);
      respond(true, pr, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "pr.merge": async ({ params, respond }) => {
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    const number = requireNumber(params, "number");
    if (!owner || !repo || number === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing owner, repo, or number"),
      );
      return;
    }
    try {
      const method = requireString(params, "method") ?? undefined;
      await gh.mergePR(owner, repo, number, method);
      respond(true, { merged: true, number }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "pr.checks": async ({ params, respond }) => {
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    const number = requireNumber(params, "number");
    if (!owner || !repo || number === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing owner, repo, or number"),
      );
      return;
    }
    try {
      const checks = await gh.getPRChecks(owner, repo, number);
      respond(true, { checks }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "pr.comment": async ({ params, respond }) => {
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    const number = requireNumber(params, "number");
    const body = requireString(params, "body");
    if (!owner || !repo || number === null || !body) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing required fields"));
      return;
    }
    try {
      await gh.commentOnPR(owner, repo, number, body);
      respond(true, { commented: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  // =========================================================================
  // ISSUE OPERATIONS
  // =========================================================================

  "issue.create": async ({ params, respond }) => {
    const input = params as IssueCreateInput;
    if (!input.owner || !input.repo || !input.title) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing required issue fields"),
      );
      return;
    }
    try {
      const issue = await gh.createIssue(input);
      respond(true, issue, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "issue.get": async ({ params, respond }) => {
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    const number = requireNumber(params, "number");
    if (!owner || !repo || number === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing owner, repo, or number"),
      );
      return;
    }
    try {
      const issue = await gh.getIssue(owner, repo, number);
      respond(true, issue, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "issue.list": async ({ params, respond }) => {
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    if (!owner || !repo) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing owner or repo"));
      return;
    }
    try {
      const filter = (params.filter ?? {}) as IssueFilter;
      const issues = await gh.listIssues(owner, repo, filter);
      respond(true, { issues }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "issue.update": async ({ params, respond }) => {
    const input = params as IssueUpdateInput;
    if (!input.owner || !input.repo || !input.number) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing required fields"));
      return;
    }
    try {
      const issue = await gh.updateIssue(input);
      respond(true, issue, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "issue.close": async ({ params, respond }) => {
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    const number = requireNumber(params, "number");
    if (!owner || !repo || number === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing owner, repo, or number"),
      );
      return;
    }
    try {
      const issue = await gh.closeIssue(owner, repo, number);
      respond(true, issue, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "issue.comment": async ({ params, respond }) => {
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    const number = requireNumber(params, "number");
    const body = requireString(params, "body");
    if (!owner || !repo || number === null || !body) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing required fields"));
      return;
    }
    try {
      await gh.commentOnIssue(owner, repo, number, body);
      respond(true, { commented: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  "issue.to_workflow": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const owner = requireString(params, "owner");
    const repo = requireString(params, "repo");
    const number = requireNumber(params, "number");
    if (!owner || !repo || number === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing owner, repo, or number"),
      );
      return;
    }
    try {
      // Fetch the issue
      const issue = await gh.getIssue(owner, repo, number);
      // Extract opts for workflow creation
      const opts = (params.opts ?? {}) as Record<string, unknown>;
      const repoPath = (opts.repoPath as string) ?? process.cwd();

      const workflow = await context.workflowService.create({
        title: issue.title,
        description: issue.body,
        trigger: "issue",
        issueNumber: issue.number,
        repoPath,
      });

      wakeAgentForWorkflow(`Workflow created from issue #${issue.number}: "${issue.title}"`);
      respond(true, workflow, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, String(err)));
    }
  },

  // =========================================================================
  // REVIEW OPERATIONS
  // =========================================================================

  "review.run": async ({ params, respond, context }) => {
    if (!context.workflowService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workflow service not available"),
      );
      return;
    }
    const workflowId = requireString(params, "workflowId");
    if (!workflowId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing workflowId"));
      return;
    }
    // For now, return a placeholder review. In production, this would spawn
    // a review session that analyses the diff.
    const review = {
      status: "complete" as const,
      summary: "Automated review pending implementation",
      score: 0,
      issues: [],
      suggestions: [],
      filesReviewed: [],
      reviewedAtMs: Date.now(),
    };
    await context.workflowService.updateWorkflow(workflowId, { review });
    respond(true, review, undefined);
  },

  "review.diff": async ({ params, respond }) => {
    const repoPath = requireString(params, "repoPath");
    const base = requireString(params, "base");
    const head = requireString(params, "head");
    if (!repoPath || !base || !head) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing repoPath, base, or head"),
      );
      return;
    }
    // Placeholder review for a diff range
    const review = {
      status: "complete" as const,
      summary: "Diff review pending implementation",
      score: 0,
      issues: [],
      suggestions: [],
      filesReviewed: [],
      reviewedAtMs: Date.now(),
    };
    respond(true, review, undefined);
  },
};

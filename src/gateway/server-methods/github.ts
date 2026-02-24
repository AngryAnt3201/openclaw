// ---------------------------------------------------------------------------
// Gateway RPC handlers for pr.*, issue.*, review.diff methods
// ---------------------------------------------------------------------------
// Extracted from the legacy workflow handler file. These handlers provide
// GitHub PR and issue operations via the `gh` CLI wrapper.
// ---------------------------------------------------------------------------

import type {
  PRCreateInput,
  PRUpdateInput,
  PRFilter,
  IssueCreateInput,
  IssueUpdateInput,
  IssueFilter,
} from "../../github/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import * as gh from "../../github/cli.js";
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

export const githubHandlers: GatewayRequestHandlers = {
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

  // =========================================================================
  // REVIEW OPERATIONS
  // =========================================================================

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

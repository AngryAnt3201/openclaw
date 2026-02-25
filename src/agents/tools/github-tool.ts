// ---------------------------------------------------------------------------
// GitHub Agent Tool – allows agents to interact with GitHub PRs and issues
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const GITHUB_ACTIONS = [
  "pr_create",
  "pr_get",
  "pr_list",
  "pr_merge",
  "pr_comment",
  "issue_create",
  "issue_list",
  "issue_get",
  "issue_close",
  "issue_comment",
] as const;

const GitHubToolSchema = Type.Object({
  action: stringEnum(GITHUB_ACTIONS),
  // Common
  owner: Type.Optional(Type.String({ description: "GitHub repo owner" })),
  repo: Type.Optional(Type.String({ description: "GitHub repo name" })),
  number: Type.Optional(Type.Number({ description: "PR or issue number" })),
  // Create PR
  title: Type.Optional(Type.String()),
  body: Type.Optional(Type.String()),
  head: Type.Optional(Type.String({ description: "Source branch for PR" })),
  base: Type.Optional(Type.String({ description: "Target branch for PR" })),
  draft: Type.Optional(Type.Boolean()),
  // PR merge
  method: Type.Optional(Type.String({ description: "Merge method: merge, squash, rebase" })),
  // Issue
  labels: Type.Optional(Type.Array(Type.String())),
  assignees: Type.Optional(Type.Array(Type.String())),
  state: Type.Optional(Type.String()),
  // Comment
  comment: Type.Optional(Type.String({ description: "Comment body text" })),
  // List filters
  limit: Type.Optional(Type.Number()),
});

export function createGitHubTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "GitHub",
    name: "github",
    description:
      "Interact with GitHub pull requests and issues. Create, list, merge PRs, " +
      "create/close issues, and add comments.",
    parameters: GitHubToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = {};

      const owner = readStringParam(params, "owner");
      const repo = readStringParam(params, "repo");

      switch (action) {
        case "pr_create": {
          const title = readStringParam(params, "title", { required: true });
          const body = readStringParam(params, "body") ?? "";
          const head = readStringParam(params, "head", { required: true });
          const base = readStringParam(params, "base", { required: true });
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const result = await callGatewayTool("pr.create", gatewayOpts, {
            owner,
            repo,
            title,
            body,
            head,
            base,
            draft: params.draft,
            labels: params.labels,
            assignees: params.assignees,
          });
          return jsonResult(result);
        }
        case "pr_get": {
          const number = readNumberParam(params, "number", { required: true });
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const result = await callGatewayTool("pr.get", gatewayOpts, { owner, repo, number });
          return jsonResult(result);
        }
        case "pr_list": {
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const filter: Record<string, unknown> = {};
          if (params.state) {
            filter.state = params.state;
          }
          if (params.labels) {
            filter.labels = params.labels;
          }
          if (params.limit) {
            filter.limit = params.limit;
          }
          const result = await callGatewayTool("pr.list", gatewayOpts, {
            owner,
            repo,
            filter,
          });
          return jsonResult(result);
        }
        case "pr_merge": {
          const number = readNumberParam(params, "number", { required: true });
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const result = await callGatewayTool("pr.merge", gatewayOpts, {
            owner,
            repo,
            number,
            method: params.method ?? "squash",
          });
          return jsonResult(result);
        }
        case "pr_comment": {
          const number = readNumberParam(params, "number", { required: true });
          const comment = readStringParam(params, "comment", { required: true });
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const result = await callGatewayTool("pr.comment", gatewayOpts, {
            owner,
            repo,
            number,
            body: comment,
          });
          return jsonResult(result);
        }
        case "issue_create": {
          const title = readStringParam(params, "title", { required: true });
          const body = readStringParam(params, "body") ?? "";
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const result = await callGatewayTool("issue.create", gatewayOpts, {
            owner,
            repo,
            title,
            body,
            labels: params.labels,
            assignees: params.assignees,
          });
          return jsonResult(result);
        }
        case "issue_get": {
          const number = readNumberParam(params, "number", { required: true });
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const result = await callGatewayTool("issue.get", gatewayOpts, { owner, repo, number });
          return jsonResult(result);
        }
        case "issue_list": {
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const filter: Record<string, unknown> = {};
          if (params.state) {
            filter.state = params.state;
          }
          if (params.labels) {
            filter.labels = params.labels;
          }
          if (params.limit) {
            filter.limit = params.limit;
          }
          const result = await callGatewayTool("issue.list", gatewayOpts, {
            owner,
            repo,
            filter,
          });
          return jsonResult(result);
        }
        case "issue_close": {
          const number = readNumberParam(params, "number", { required: true });
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const result = await callGatewayTool("issue.close", gatewayOpts, {
            owner,
            repo,
            number,
          });
          return jsonResult(result);
        }
        case "issue_comment": {
          const number = readNumberParam(params, "number", { required: true });
          const comment = readStringParam(params, "comment", { required: true });
          if (!owner || !repo) {
            throw new Error("owner and repo are required");
          }
          const result = await callGatewayTool("issue.comment", gatewayOpts, {
            owner,
            repo,
            number,
            body: comment,
          });
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown GitHub action: ${action}`);
      }
    },
  };
}

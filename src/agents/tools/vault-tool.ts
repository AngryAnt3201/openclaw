// ---------------------------------------------------------------------------
// Vault Agent Tool – allows agents to create, query, and manage vault notes
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import {
  type AnyAgentTool,
  jsonResult,
  readStringParam,
  readStringArrayParam,
  readNumberParam,
} from "./common.js";
import { callGatewayTool } from "./gateway.js";

const VAULT_ACTIONS = [
  "create",
  "get",
  "update",
  "delete",
  "list",
  "search",
  "daily",
  "tags",
  "backlinks",
] as const;

const VaultToolSchema = Type.Object({
  action: stringEnum(VAULT_ACTIONS, {
    description:
      "create: create a new note. get: read a note by path. update: update note content. delete: delete a note. list: list all notes. search: full-text search. daily: get/create today's daily note. tags: list all tags. backlinks: get notes linking to a path.",
  }),
  // create / get / update / delete / backlinks
  path: Type.Optional(
    Type.String({
      description:
        "Note path relative to vault root, e.g. 'projects/my-project.md' or 'daily/2026-02-15.md'",
    }),
  ),
  // create
  title: Type.Optional(Type.String({ description: "Note title (for create)" })),
  // create / update
  content: Type.Optional(Type.String({ description: "Markdown content for the note body" })),
  // create
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags to attach to the note" })),
  // create
  folder: Type.Optional(
    Type.String({
      description: "Folder path for the note, e.g. 'projects' or 'research/ai'",
    }),
  ),
  // search
  query: Type.Optional(Type.String({ description: "Search query for full-text vault search" })),
  // search / list
  limit: Type.Optional(Type.Number({ description: "Maximum number of results to return" })),
  // daily
  date: Type.Optional(
    Type.String({
      description: "Date for daily note in YYYY-MM-DD format. Defaults to today.",
    }),
  ),
});

export function createVaultTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Vault",
    name: "vault",
    description:
      "Manage the Miranda knowledge vault — an Obsidian-compatible markdown note system. Create notes to persist research findings, project context, meeting notes, or any important information. Search and query existing notes. Notes support wiki-links ([[note]]), tags (#tag), and frontmatter.\n\nCommon paths: 'projects/<name>.md', 'research/<topic>.md', 'daily/<date>.md', 'tasks/<id>.md'.",
    parameters: VaultToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const gatewayOpts = {};

      switch (action) {
        case "create": {
          const path = readStringParam(params, "path", { required: true });
          const title = readStringParam(params, "title");
          const content = readStringParam(params, "content") ?? "";
          const tags = readStringArrayParam(params, "tags");
          const folder = readStringParam(params, "folder");

          const createPayload: Record<string, unknown> = {
            path,
            content,
          };
          if (title) {
            createPayload.title = title;
          }
          if (tags) {
            createPayload.tags = tags;
          }
          if (folder) {
            createPayload.folder = folder;
          }

          const result = await callGatewayTool("vault.create", gatewayOpts, createPayload);
          return jsonResult(result);
        }
        case "get": {
          const path = readStringParam(params, "path", { required: true });
          const result = await callGatewayTool("vault.get", gatewayOpts, {
            path,
          });
          return jsonResult(result);
        }
        case "update": {
          const path = readStringParam(params, "path", { required: true });
          const content = readStringParam(params, "content", { required: true });
          const result = await callGatewayTool("vault.update", gatewayOpts, {
            path,
            content,
          });
          return jsonResult(result);
        }
        case "delete": {
          const path = readStringParam(params, "path", { required: true });
          const result = await callGatewayTool("vault.delete", gatewayOpts, {
            path,
          });
          return jsonResult(result);
        }
        case "list": {
          const filter: Record<string, unknown> = {};
          const folder = readStringParam(params, "folder");
          const limit = readNumberParam(params, "limit");
          if (folder) {
            filter.folder = folder;
          }
          if (limit) {
            filter.limit = limit;
          }
          const result = await callGatewayTool("vault.list", gatewayOpts, filter);
          return jsonResult(result);
        }
        case "search": {
          const query = readStringParam(params, "query", { required: true });
          const limit = readNumberParam(params, "limit") ?? 20;
          const result = await callGatewayTool("vault.search", gatewayOpts, {
            query,
            limit,
          });
          return jsonResult(result);
        }
        case "daily": {
          const date = readStringParam(params, "date");
          const payload: Record<string, unknown> = {};
          if (date) {
            payload.date = date;
          }
          const result = await callGatewayTool("vault.daily", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "tags": {
          const result = await callGatewayTool("vault.tags", gatewayOpts, {});
          return jsonResult(result);
        }
        case "backlinks": {
          const path = readStringParam(params, "path", { required: true });
          const result = await callGatewayTool("vault.backlinks", gatewayOpts, {
            path,
          });
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown vault action: ${action}`);
      }
    },
  };
}

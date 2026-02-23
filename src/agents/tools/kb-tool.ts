// ---------------------------------------------------------------------------
// KB Agent Tool – allows agents to create, query, and search the knowledge base
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

const KB_ACTIONS = ["create", "get", "list", "search", "tags"] as const;

const KBToolSchema = Type.Object({
  action: stringEnum(KB_ACTIONS, {
    description:
      "create: create a new note. get: read a note by path. list: list all notes. search: full-text search. tags: list all tags.",
  }),
  // create / get
  path: Type.Optional(
    Type.String({
      description:
        "Note path relative to knowledge base root, e.g. 'projects/my-project.md' or 'research/topic.md'",
    }),
  ),
  // create
  title: Type.Optional(Type.String({ description: "Note title (for create)" })),
  // create
  content: Type.Optional(Type.String({ description: "Markdown content for the note body" })),
  // create
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags to attach to the note" })),
  // create / list
  folder: Type.Optional(
    Type.String({
      description: "Folder path for the note, e.g. 'projects' or 'research/ai'",
    }),
  ),
  // search
  query: Type.Optional(
    Type.String({ description: "Search query for full-text knowledge base search" }),
  ),
  // search / list
  limit: Type.Optional(Type.Number({ description: "Maximum number of results to return" })),
});

export function createKBTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Knowledge Base",
    name: "kb",
    description:
      "Manage the Miranda knowledge base — a markdown note system for persistent storage. Create notes to persist research findings, project context, meeting notes, or any important information. Search and query existing notes. Notes support wiki-links ([[note]]), tags (#tag), and frontmatter.\n\nCommon paths: 'projects/<name>.md', 'research/<topic>.md', 'tasks/<id>.md'.",
    parameters: KBToolSchema,
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

          const result = await callGatewayTool("kb.create", gatewayOpts, createPayload);
          return jsonResult(result);
        }
        case "get": {
          const path = readStringParam(params, "path", { required: true });
          const result = await callGatewayTool("kb.get", gatewayOpts, {
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
          const result = await callGatewayTool("kb.list", gatewayOpts, filter);
          return jsonResult(result);
        }
        case "search": {
          const query = readStringParam(params, "query", { required: true });
          const limit = readNumberParam(params, "limit") ?? 20;
          const result = await callGatewayTool("kb.search", gatewayOpts, {
            query,
            limit,
          });
          return jsonResult(result);
        }
        case "tags": {
          const result = await callGatewayTool("kb.tags", gatewayOpts, {});
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown kb action: ${action}`);
      }
    },
  };
}

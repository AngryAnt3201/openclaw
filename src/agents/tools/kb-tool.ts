// ---------------------------------------------------------------------------
// Knowledge Base Agent Tool – allows agents to read, create, and search KB notes
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

const KB_ACTIONS = [
  "list",
  "get",
  "create",
  "search",
  "tags",
] as const;

const KBToolSchema = Type.Object({
  action: stringEnum(KB_ACTIONS, {
    description:
      "list: list notes in the knowledge base. get: read a note by path. create: create a new note. search: full-text search. tags: list all tags.",
  }),
  // get / create
  path: Type.Optional(
    Type.String({
      description:
        "Note path relative to KB root, e.g. 'research/my-topic.md' or 'projects/summary.md'",
    }),
  ),
  // create
  content: Type.Optional(Type.String({ description: "Markdown content for the note body" })),
  // create
  frontmatter: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "YAML frontmatter key-value pairs",
    }),
  ),
  // search
  query: Type.Optional(Type.String({ description: "Search query for knowledge base search" })),
  // list / search
  folder: Type.Optional(Type.String({ description: "Folder to scope the listing to" })),
  // list / search
  limit: Type.Optional(Type.Number({ description: "Maximum number of results to return" })),
  // list
  tags: Type.Optional(
    Type.Array(Type.String(), { description: "Filter by tags" }),
  ),
});

export function createKBTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Knowledge Base",
    name: "kb",
    description:
      "Read, create, and search notes in the connected knowledge base (Obsidian, Logseq, Notion, or custom). " +
      "Use to persist research findings, project context, meeting notes, or any important information. " +
      "Notes support wiki-links ([[note]]), tags (#tag), and YAML frontmatter.\n\n" +
      "Actions: list, get, create, search, tags.",
    parameters: KBToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const gatewayOpts = {};

      switch (action) {
        case "list": {
          const filter: Record<string, unknown> = {};
          const folder = readStringParam(params, "folder");
          const tags = readStringArrayParam(params, "tags");
          const limit = readNumberParam(params, "limit");
          if (folder) filter.folder = folder;
          if (tags) filter.tags = tags;
          if (limit) filter.limit = limit;
          const result = await callGatewayTool("kb.list", gatewayOpts, filter);
          return jsonResult(result);
        }
        case "get": {
          const notePath = readStringParam(params, "path", { required: true });
          const result = await callGatewayTool("kb.get", gatewayOpts, { path: notePath });
          return jsonResult(result);
        }
        case "create": {
          const notePath = readStringParam(params, "path", { required: true });
          const content = readStringParam(params, "content") ?? "";
          const frontmatter = params.frontmatter as Record<string, unknown> | undefined;
          const payload: Record<string, unknown> = { path: notePath, content };
          if (frontmatter) payload.frontmatter = frontmatter;
          const result = await callGatewayTool("kb.create", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "search": {
          const query = readStringParam(params, "query", { required: true });
          const limit = readNumberParam(params, "limit") ?? 20;
          const result = await callGatewayTool("kb.search", gatewayOpts, { query, limit });
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

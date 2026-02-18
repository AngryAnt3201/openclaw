// ---------------------------------------------------------------------------
// File Agent Tool – allows agents to browse/read files on connected nodes
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const FILE_ACTIONS = ["list", "read", "stat"] as const;

const FileToolSchema = Type.Object({
  action: stringEnum(FILE_ACTIONS),
  nodeId: Type.String({ description: "Node ID of the connected node to access files on" }),
  path: Type.String({ description: "File or directory path (absolute or ~-relative)" }),
  // list options
  hidden: Type.Optional(Type.Boolean({ description: "Include hidden files (default: false)" })),
  limit: Type.Optional(Type.Number({ description: "Max entries to return (default: 1000)" })),
  // read options
  offset: Type.Optional(Type.Number({ description: "Byte offset to start reading from" })),
  maxBytes: Type.Optional(Type.Number({ description: "Max bytes to read (default: 1MB)" })),
  encoding: Type.Optional(
    stringEnum(["utf8", "base64"], { description: "Encoding (default: utf8)" }),
  ),
});

export function createFileTool(_opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "File",
    name: "file",
    description:
      "Browse and read files on connected remote nodes. Use action=list to list directory contents, action=read to read file contents, action=stat to get file metadata. All paths are on the remote node, not the gateway.",
    parameters: FileToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const nodeId = readStringParam(params, "nodeId", { required: true });
      const filePath = readStringParam(params, "path", { required: true });

      switch (action) {
        case "list": {
          const result = await callGatewayTool("file.list", {
            nodeId,
            path: filePath,
            hidden: params.hidden === true,
            limit: readNumberParam(params, "limit"),
          });
          return jsonResult(result);
        }

        case "read": {
          const result = await callGatewayTool("file.read", {
            nodeId,
            path: filePath,
            offset: readNumberParam(params, "offset"),
            limit: readNumberParam(params, "maxBytes"),
            encoding: readStringParam(params, "encoding"),
          });
          return jsonResult(result);
        }

        case "stat": {
          const result = await callGatewayTool("file.stat", {
            nodeId,
            path: filePath,
          });
          return jsonResult(result);
        }

        default:
          return jsonResult({ error: `Unknown file action: ${action}` });
      }
    },
  };
}

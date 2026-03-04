// ---------------------------------------------------------------------------
// File Agent Tool – allows agents to browse/read files on connected nodes
// ---------------------------------------------------------------------------
// Access is restricted to workspace directories when a workspace is bound.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { normalize } from "node:path";
import { resolveAllowedFilePathsForSession } from "../../workspaces/resolve-hook.js";
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

/**
 * Check if `filePath` is within any of the allowed root directories.
 * Normalizes both sides to prevent traversal attacks (../).
 */
function isPathAllowed(filePath: string, allowedRoots: string[]): boolean {
  const normalizedPath = normalize(filePath);
  return allowedRoots.some((root) => {
    const normalizedRoot = normalize(root);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + "/");
  });
}

export function createFileTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  const sessionKey = opts?.agentSessionKey;

  return {
    label: "File",
    name: "file",
    description:
      "Browse and read files within your workspace directories on connected remote nodes. Use action=list to list directory contents, action=read to read file contents, action=stat to get file metadata. Access is restricted to directories in your assigned workspace.",
    parameters: FileToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const nodeId = readStringParam(params, "nodeId", { required: true });
      const filePath = readStringParam(params, "path", { required: true });

      // Resolve allowed paths from workspace binding
      const allowedPaths = sessionKey ? await resolveAllowedFilePathsForSession(sessionKey) : [];

      if (allowedPaths.length > 0 && !isPathAllowed(filePath, allowedPaths)) {
        return jsonResult({
          error: "Access denied — path is outside your workspace directories.",
          allowedRoots: allowedPaths,
          requestedPath: filePath,
        });
      }

      if (allowedPaths.length === 0 && sessionKey) {
        return jsonResult({
          error:
            "No workspace directories are bound to your session. Ask the user to assign a workspace with directories first.",
        });
      }

      switch (action) {
        case "list": {
          const result = await callGatewayTool(
            "file.list",
            {},
            {
              nodeId,
              path: filePath,
              hidden: params.hidden === true,
              limit: readNumberParam(params, "limit"),
            },
          );
          return jsonResult(result);
        }

        case "read": {
          const result = await callGatewayTool(
            "file.read",
            {},
            {
              nodeId,
              path: filePath,
              offset: readNumberParam(params, "offset"),
              limit: readNumberParam(params, "maxBytes"),
              encoding: readStringParam(params, "encoding"),
            },
          );
          return jsonResult(result);
        }

        case "stat": {
          const result = await callGatewayTool(
            "file.stat",
            {},
            {
              nodeId,
              path: filePath,
            },
          );
          return jsonResult(result);
        }

        default:
          return jsonResult({ error: `Unknown file action: ${action}` });
      }
    },
  };
}

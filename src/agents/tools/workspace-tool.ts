// ---------------------------------------------------------------------------
// Workspace Agent Tool – allows agents to query and manage workspaces
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const WORKSPACE_ACTIONS = ["list", "get", "status", "resolve", "switch_dir"] as const;

const WorkspaceToolSchema = Type.Object({
  action: stringEnum(WORKSPACE_ACTIONS),
  id: Type.Optional(Type.String({ description: "Workspace ID (for get/status)" })),
  sessionKey: Type.Optional(Type.String({ description: "Session key (for resolve)" })),
  agentId: Type.Optional(Type.String({ description: "Agent ID (for resolve)" })),
  directoryId: Type.Optional(
    Type.String({ description: "Directory ID within workspace (for switch_dir)" }),
  ),
  tag: Type.Optional(Type.String({ description: "Filter by tag (for list)" })),
  deviceId: Type.Optional(Type.String({ description: "Filter by device ID (for list)" })),
});

export function createWorkspaceTool(): AnyAgentTool {
  return {
    label: "Workspace",
    name: "workspace",
    description:
      "Query and manage remote workspaces. " +
      "Actions: list (browse workspaces), get (details), status (mount state), " +
      "resolve (find workspace for session/agent), switch_dir (change active directory).",
    parameters: WorkspaceToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action") ?? "list";

      switch (action) {
        case "list": {
          const filter: Record<string, unknown> = {};
          if (params.tag) {
            filter.tag = params.tag;
          }
          if (params.deviceId) {
            filter.deviceId = params.deviceId;
          }
          return jsonResult(await callGatewayTool("workspace.list", {}, filter));
        }

        case "get": {
          const id = readStringParam(params, "id");
          if (!id) {
            return jsonResult({ error: "Missing workspace id" });
          }
          return jsonResult(await callGatewayTool("workspace.get", {}, { id }));
        }

        case "status": {
          const id = readStringParam(params, "id");
          if (!id) {
            return jsonResult({ error: "Missing workspace id" });
          }
          return jsonResult(await callGatewayTool("workspace.status", {}, { id }));
        }

        case "resolve": {
          const sessionKey = readStringParam(params, "sessionKey");
          if (!sessionKey) {
            return jsonResult({ error: "Missing sessionKey" });
          }
          return jsonResult(
            await callGatewayTool(
              "workspace.resolve",
              {},
              {
                sessionKey,
                agentId: params.agentId,
              },
            ),
          );
        }

        case "switch_dir": {
          const id = readStringParam(params, "id");
          const directoryId = readStringParam(params, "directoryId");
          if (!id || !directoryId) {
            return jsonResult({ error: "Missing workspace id or directoryId" });
          }
          return jsonResult(await callGatewayTool("workspace.status", {}, { id }));
        }

        default:
          return jsonResult({ error: `Unknown action: ${action}` });
      }
    },
  };
}

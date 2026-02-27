// ---------------------------------------------------------------------------
// Group Agent Tool – allows agents to manage group chats
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const GROUP_ACTIONS = ["create", "list", "send"] as const;

const GroupToolSchema = Type.Object({
  action: stringEnum(GROUP_ACTIONS),
  // create
  label: Type.Optional(Type.String()),
  agents: Type.Optional(Type.Array(Type.String())),
  // send
  groupId: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
});

export function createGroupTool(_opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Group Chat",
    name: "group",
    description:
      "Manage group chats. Actions: create (start a new group chat with agents), list (show all groups), send (send a message to a group).",
    parameters: GroupToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = {};

      switch (action) {
        case "create": {
          const label = readStringParam(params, "label", { required: true });
          const agents = params.agents;
          if (!Array.isArray(agents) || agents.length === 0) {
            throw new Error("agents must be a non-empty array of agent IDs");
          }
          const result = await callGatewayTool("group.create", gatewayOpts, {
            label,
            agents,
          });
          return jsonResult(result);
        }
        case "list": {
          const result = await callGatewayTool("group.list", gatewayOpts, {});
          return jsonResult(result);
        }
        case "send": {
          const groupId = readStringParam(params, "groupId", { required: true });
          const message = readStringParam(params, "message", { required: true });
          const result = await callGatewayTool("group.send", gatewayOpts, {
            groupId,
            message,
          });
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown group action: ${action}`);
      }
    },
  };
}

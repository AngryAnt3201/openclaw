// ---------------------------------------------------------------------------
// Plugin Agent Tool – allows agents to manage plugins (reload, list)
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const PLUGIN_ACTIONS = ["reload", "list"] as const;

const PluginToolSchema = Type.Object({
  action: stringEnum(PLUGIN_ACTIONS),
});

export function createPluginTool(_opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Plugin",
    name: "plugin",
    description:
      "Manage OpenClaw plugins. Use 'reload' to clear plugin caches and re-discover plugins (after writing a new plugin to ~/.openclaw/extensions/). Use 'list' to see loaded plugins, their tools, and any diagnostics.",
    parameters: PluginToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const gatewayOpts = {};

      switch (action) {
        case "reload": {
          const result = await callGatewayTool("plugins.reload", gatewayOpts);
          return jsonResult(result);
        }

        case "list": {
          const result = await callGatewayTool("plugins.list", gatewayOpts);
          return jsonResult(result);
        }

        default:
          throw new Error(`Unknown plugin action: ${action}`);
      }
    },
  };
}

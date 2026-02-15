// ---------------------------------------------------------------------------
// Launcher Agent Tool – allows agents to manage launcher apps
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const LAUNCHER_ACTIONS = [
  "create",
  "update",
  "delete",
  "list",
  "get",
  "pin",
  "unpin",
  "scan",
  "suggest",
] as const;

const APP_CATEGORIES = [
  "native",
  "dev-server",
  "web-embed",
  "custom",
  "service",
  "script",
] as const;

const LauncherToolSchema = Type.Object({
  action: stringEnum(LAUNCHER_ACTIONS),
  // create / update
  name: Type.Optional(Type.String({ description: "App display name" })),
  description: Type.Optional(Type.String({ description: "Short description of the app" })),
  category: Type.Optional(
    stringEnum(APP_CATEGORIES, {
      description:
        "native: macOS .app. dev-server: local dev server. web-embed: website/webapp. custom: user-defined.",
    }),
  ),
  icon: Type.Optional(Type.String({ description: "Emoji or icon identifier" })),
  app_path: Type.Optional(
    Type.String({ description: "macOS .app path (for native), e.g. /Applications/Slack.app" }),
  ),
  bundle_id: Type.Optional(Type.String({ description: "macOS bundle ID (for native)" })),
  url: Type.Optional(Type.String({ description: "URL (for web-embed)" })),
  run_command: Type.Optional(Type.String({ description: "Shell command (for dev-server)" })),
  working_dir: Type.Optional(Type.String({ description: "Working directory (for dev-server)" })),
  port: Type.Optional(Type.Number({ description: "Port number (for dev-server)" })),
  device_id: Type.Optional(Type.String({ description: "Device ID to associate this app with" })),
  env_vars: Type.Optional(
    Type.Record(Type.String(), Type.String(), { description: "Environment variables" }),
  ),
  health_check_url: Type.Optional(Type.String({ description: "URL to check app health" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags for the app" })),
  color: Type.Optional(Type.String({ description: "Color identifier" })),
  // get / update / delete / pin / unpin
  appId: Type.Optional(Type.String({ description: "App ID" })),
  id: Type.Optional(Type.String({ description: "App ID (alias)" })),
  // pin
  order: Type.Optional(Type.Number({ description: "Pin order (0-based)" })),
  // list filter
  pinned: Type.Optional(Type.Boolean({ description: "Filter by pinned status" })),
  limit: Type.Optional(Type.Number({ description: "Max results to return" })),
});

export function createLauncherTool(_opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Launcher",
    name: "launcher",
    description:
      "Manage the user's app launcher. Add, remove, pin/unpin apps. Scan for installed macOS apps and suggest additions. Apps appear on the Miranda home screen arc.\n\nCategories: native (macOS .app), dev-server (local dev project), web-embed (website), custom (user-defined), service (background service), script (runnable script).\n\nApps can be associated with a device via device_id.",
    parameters: LauncherToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const gatewayOpts = {};

      switch (action) {
        case "create": {
          const name = readStringParam(params, "name", { required: true });
          const createPayload: Record<string, unknown> = { name };
          if (params.description !== undefined) {
            createPayload.description = params.description;
          }
          if (params.category !== undefined) {
            createPayload.category = params.category;
          }
          if (params.icon !== undefined) {
            createPayload.icon = params.icon;
          }
          if (params.app_path !== undefined) {
            createPayload.app_path = params.app_path;
          }
          if (params.bundle_id !== undefined) {
            createPayload.bundle_id = params.bundle_id;
          }
          if (params.url !== undefined) {
            createPayload.url = params.url;
          }
          if (params.run_command !== undefined) {
            createPayload.run_command = params.run_command;
          }
          if (params.working_dir !== undefined) {
            createPayload.working_dir = params.working_dir;
          }
          if (params.port !== undefined) {
            createPayload.port = params.port;
          }
          if (params.device_id !== undefined) {
            createPayload.device_id = params.device_id;
          }
          if (params.env_vars !== undefined) {
            createPayload.env_vars = params.env_vars;
          }
          if (params.health_check_url !== undefined) {
            createPayload.health_check_url = params.health_check_url;
          }
          if (params.tags !== undefined) {
            createPayload.tags = params.tags;
          }
          if (params.color !== undefined) {
            createPayload.color = params.color;
          }

          const result = await callGatewayTool("launcher.create", gatewayOpts, createPayload);
          return jsonResult(result);
        }

        case "update": {
          const appId = readStringParam(params, "appId") ?? readStringParam(params, "id");
          if (!appId) {
            throw new Error("appId is required for launcher update");
          }

          const patch: Record<string, unknown> = {};
          if (params.name !== undefined) {
            patch.name = params.name;
          }
          if (params.description !== undefined) {
            patch.description = params.description;
          }
          if (params.category !== undefined) {
            patch.category = params.category;
          }
          if (params.icon !== undefined) {
            patch.icon = params.icon;
          }
          if (params.app_path !== undefined) {
            patch.app_path = params.app_path;
          }
          if (params.bundle_id !== undefined) {
            patch.bundle_id = params.bundle_id;
          }
          if (params.url !== undefined) {
            patch.url = params.url;
          }
          if (params.run_command !== undefined) {
            patch.run_command = params.run_command;
          }
          if (params.working_dir !== undefined) {
            patch.working_dir = params.working_dir;
          }
          if (params.port !== undefined) {
            patch.port = params.port;
          }
          if (params.device_id !== undefined) {
            patch.device_id = params.device_id;
          }
          if (params.env_vars !== undefined) {
            patch.env_vars = params.env_vars;
          }
          if (params.health_check_url !== undefined) {
            patch.health_check_url = params.health_check_url;
          }
          if (params.tags !== undefined) {
            patch.tags = params.tags;
          }
          if (params.color !== undefined) {
            patch.color = params.color;
          }

          const result = await callGatewayTool("launcher.update", gatewayOpts, {
            appId,
            patch,
          });
          return jsonResult(result);
        }

        case "delete": {
          const appId = readStringParam(params, "appId") ?? readStringParam(params, "id");
          if (!appId) {
            throw new Error("appId is required for launcher delete");
          }
          const result = await callGatewayTool("launcher.delete", gatewayOpts, { appId });
          return jsonResult(result);
        }

        case "list": {
          const filter: Record<string, unknown> = {};
          if (params.category) {
            filter.category = params.category;
          }
          if (params.pinned !== undefined) {
            filter.pinned = params.pinned;
          }
          if (params.limit) {
            filter.limit = params.limit;
          }
          const result = await callGatewayTool("launcher.list", gatewayOpts, filter);
          return jsonResult(result);
        }

        case "get": {
          const appId = readStringParam(params, "appId") ?? readStringParam(params, "id");
          if (!appId) {
            throw new Error("appId is required for launcher get");
          }
          const result = await callGatewayTool("launcher.get", gatewayOpts, { appId });
          return jsonResult(result);
        }

        case "pin": {
          const appId = readStringParam(params, "appId") ?? readStringParam(params, "id");
          if (!appId) {
            throw new Error("appId is required for launcher pin");
          }
          const order = readNumberParam(params, "order") ?? 0;
          const result = await callGatewayTool("launcher.pin", gatewayOpts, { appId, order });
          return jsonResult(result);
        }

        case "unpin": {
          const appId = readStringParam(params, "appId") ?? readStringParam(params, "id");
          if (!appId) {
            throw new Error("appId is required for launcher unpin");
          }
          const result = await callGatewayTool("launcher.unpin", gatewayOpts, { appId });
          return jsonResult(result);
        }

        case "scan": {
          // Return cached discovered apps from the store
          const result = await callGatewayTool("launcher.discovered.list", gatewayOpts);
          return jsonResult(result);
        }

        case "suggest": {
          // Get discovered apps and current launcher apps, compute diff
          const [discovered, current] = await Promise.all([
            callGatewayTool<{ apps: Array<{ name: string; bundle_id: string; path: string }> }>(
              "launcher.discovered.list",
              gatewayOpts,
            ),
            callGatewayTool<{ apps: Array<{ bundle_id: string | null; name: string }> }>(
              "launcher.list",
              gatewayOpts,
            ),
          ]);

          const discoveredApps = (discovered as { apps?: unknown[] })?.apps ?? [];
          const currentApps = (current as { apps?: unknown[] })?.apps ?? [];
          const currentBundleIds = new Set(
            (currentApps as Array<{ bundle_id?: string | null }>)
              .map((a) => a.bundle_id)
              .filter(Boolean),
          );

          const suggestions = (
            discoveredApps as Array<{ name: string; bundle_id: string; path: string }>
          ).filter((d) => !currentBundleIds.has(d.bundle_id));

          return jsonResult({
            suggestions,
            currentCount: currentApps.length,
            discoveredCount: discoveredApps.length,
            newCount: suggestions.length,
          });
        }

        default:
          throw new Error(`Unknown launcher action: ${action}`);
      }
    },
  };
}

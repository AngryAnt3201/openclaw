// ---------------------------------------------------------------------------
// Device Agent Tool – allows agents to manage the device registry
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const DEVICE_ACTIONS = ["list", "get", "create", "update", "delete"] as const;
const DEVICE_TYPES = ["local", "remote"] as const;
const DEVICE_STATUSES = ["online", "offline", "unknown"] as const;
const CONNECTION_METHODS = ["local", "ssh", "websocket"] as const;

const DeviceToolSchema = Type.Object({
  action: stringEnum(DEVICE_ACTIONS),
  // get / update / delete
  deviceId: Type.Optional(Type.String({ description: "Device ID" })),
  id: Type.Optional(Type.String({ description: "Device ID (alias)" })),
  // create / update
  name: Type.Optional(Type.String({ description: "Device display name" })),
  type: Type.Optional(stringEnum(DEVICE_TYPES, { description: "local or remote" })),
  status: Type.Optional(stringEnum(DEVICE_STATUSES, { description: "Device status" })),
  hostname: Type.Optional(Type.String({ description: "Hostname" })),
  ip_address: Type.Optional(Type.String({ description: "IP address" })),
  platform: Type.Optional(Type.String({ description: "Platform (darwin, linux, windows)" })),
  connection_method: Type.Optional(
    stringEnum(CONNECTION_METHODS, { description: "Connection method" }),
  ),
  ssh_host: Type.Optional(Type.String({ description: "SSH host" })),
  ssh_port: Type.Optional(Type.Number({ description: "SSH port" })),
  ssh_user: Type.Optional(Type.String({ description: "SSH user" })),
  ssh_key_path: Type.Optional(Type.String({ description: "SSH key path" })),
  ws_url: Type.Optional(Type.String({ description: "WebSocket URL" })),
  is_default: Type.Optional(Type.Boolean({ description: "Set as default device" })),
  tags: Type.Optional(Type.Array(Type.String(), { description: "Tags" })),
  notes: Type.Optional(Type.String({ description: "Notes" })),
});

export function createDeviceTool(_opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Device",
    name: "device",
    description:
      "Manage the device registry. Register local and remote machines. Each device has a connection method (local, ssh, websocket), platform info, and can be tagged. Apps in the launcher can be associated with devices.",
    parameters: DeviceToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const gatewayOpts = {};

      switch (action) {
        case "list": {
          const result = await callGatewayTool("device.registry.list", gatewayOpts);
          return jsonResult(result);
        }

        case "get": {
          const deviceId = readStringParam(params, "deviceId") ?? readStringParam(params, "id");
          if (!deviceId) {
            throw new Error("deviceId is required for device get");
          }
          const result = await callGatewayTool("device.registry.get", gatewayOpts, { deviceId });
          return jsonResult(result);
        }

        case "create": {
          const name = readStringParam(params, "name", { required: true });
          const createPayload: Record<string, unknown> = { name };
          if (params.type !== undefined) {
            createPayload.type = params.type;
          }
          if (params.hostname !== undefined) {
            createPayload.hostname = params.hostname;
          }
          if (params.ip_address !== undefined) {
            createPayload.ip_address = params.ip_address;
          }
          if (params.platform !== undefined) {
            createPayload.platform = params.platform;
          }
          if (params.is_default !== undefined) {
            createPayload.is_default = params.is_default;
          }
          if (params.tags !== undefined) {
            createPayload.tags = params.tags;
          }
          if (params.notes !== undefined) {
            createPayload.notes = params.notes;
          }

          // Build connection object from flat params
          const connection: Record<string, unknown> = {};
          if (params.connection_method !== undefined) {
            connection.method = params.connection_method;
          }
          if (params.ssh_host !== undefined) {
            connection.ssh_host = params.ssh_host;
          }
          if (params.ssh_port !== undefined) {
            connection.ssh_port = params.ssh_port;
          }
          if (params.ssh_user !== undefined) {
            connection.ssh_user = params.ssh_user;
          }
          if (params.ssh_key_path !== undefined) {
            connection.ssh_key_path = params.ssh_key_path;
          }
          if (params.ws_url !== undefined) {
            connection.ws_url = params.ws_url;
          }
          if (Object.keys(connection).length > 0) {
            createPayload.connection = connection;
          }

          const result = await callGatewayTool(
            "device.registry.create",
            gatewayOpts,
            createPayload,
          );
          return jsonResult(result);
        }

        case "update": {
          const deviceId = readStringParam(params, "deviceId") ?? readStringParam(params, "id");
          if (!deviceId) {
            throw new Error("deviceId is required for device update");
          }

          const patch: Record<string, unknown> = {};
          if (params.name !== undefined) {
            patch.name = params.name;
          }
          if (params.type !== undefined) {
            patch.type = params.type;
          }
          if (params.status !== undefined) {
            patch.status = params.status;
          }
          if (params.hostname !== undefined) {
            patch.hostname = params.hostname;
          }
          if (params.ip_address !== undefined) {
            patch.ip_address = params.ip_address;
          }
          if (params.platform !== undefined) {
            patch.platform = params.platform;
          }
          if (params.is_default !== undefined) {
            patch.is_default = params.is_default;
          }
          if (params.tags !== undefined) {
            patch.tags = params.tags;
          }
          if (params.notes !== undefined) {
            patch.notes = params.notes;
          }

          const connection: Record<string, unknown> = {};
          if (params.connection_method !== undefined) {
            connection.method = params.connection_method;
          }
          if (params.ssh_host !== undefined) {
            connection.ssh_host = params.ssh_host;
          }
          if (params.ssh_port !== undefined) {
            connection.ssh_port = params.ssh_port;
          }
          if (params.ssh_user !== undefined) {
            connection.ssh_user = params.ssh_user;
          }
          if (params.ssh_key_path !== undefined) {
            connection.ssh_key_path = params.ssh_key_path;
          }
          if (params.ws_url !== undefined) {
            connection.ws_url = params.ws_url;
          }
          if (Object.keys(connection).length > 0) {
            patch.connection = connection;
          }

          const result = await callGatewayTool("device.registry.update", gatewayOpts, {
            deviceId,
            patch,
          });
          return jsonResult(result);
        }

        case "delete": {
          const deviceId = readStringParam(params, "deviceId") ?? readStringParam(params, "id");
          if (!deviceId) {
            throw new Error("deviceId is required for device delete");
          }
          const result = await callGatewayTool("device.registry.delete", gatewayOpts, { deviceId });
          return jsonResult(result);
        }

        default:
          throw new Error(`Unknown device action: ${action}`);
      }
    },
  };
}

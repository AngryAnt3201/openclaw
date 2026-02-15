// ---------------------------------------------------------------------------
// Gateway RPC handlers for device.registry.* methods
// ---------------------------------------------------------------------------

import type { DeviceCreateInput, DevicePatch } from "../../devices/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

function requireDeviceService(context: { deviceService?: unknown }) {
  if (!context.deviceService) {
    return null;
  }
  return context.deviceService as import("../../devices/service.js").DeviceService;
}

export const deviceRegistryHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // device.registry.list
  // -------------------------------------------------------------------------
  "device.registry.list": async ({ respond, context }) => {
    const svc = requireDeviceService(context);
    if (!svc) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "device registry not available"),
      );
      return;
    }
    const devices = await svc.list();
    respond(true, { devices }, undefined);
  },

  // -------------------------------------------------------------------------
  // device.registry.get
  // -------------------------------------------------------------------------
  "device.registry.get": async ({ params, respond, context }) => {
    const svc = requireDeviceService(context);
    if (!svc) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "device registry not available"),
      );
      return;
    }
    const deviceId = requireString(params, "deviceId") ?? requireString(params, "id");
    if (!deviceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing deviceId"));
      return;
    }
    const device = await svc.get(deviceId);
    if (!device) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `device not found: ${deviceId}`),
      );
      return;
    }
    respond(true, device, undefined);
  },

  // -------------------------------------------------------------------------
  // device.registry.create
  // -------------------------------------------------------------------------
  "device.registry.create": async ({ params, respond, context }) => {
    const svc = requireDeviceService(context);
    if (!svc) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "device registry not available"),
      );
      return;
    }
    const input = params as DeviceCreateInput;
    if (!input.name || typeof input.name !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    const device = await svc.create(input);
    respond(true, device, undefined);
  },

  // -------------------------------------------------------------------------
  // device.registry.update
  // -------------------------------------------------------------------------
  "device.registry.update": async ({ params, respond, context }) => {
    const svc = requireDeviceService(context);
    if (!svc) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "device registry not available"),
      );
      return;
    }
    const deviceId = requireString(params, "deviceId") ?? requireString(params, "id");
    if (!deviceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing deviceId"));
      return;
    }
    const patch = (params.patch ?? params) as DevicePatch;
    const device = await svc.update(deviceId, patch);
    if (!device) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `device not found: ${deviceId}`),
      );
      return;
    }
    respond(true, device, undefined);
  },

  // -------------------------------------------------------------------------
  // device.registry.delete
  // -------------------------------------------------------------------------
  "device.registry.delete": async ({ params, respond, context }) => {
    const svc = requireDeviceService(context);
    if (!svc) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "device registry not available"),
      );
      return;
    }
    const deviceId = requireString(params, "deviceId") ?? requireString(params, "id");
    if (!deviceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing deviceId"));
      return;
    }
    const deleted = await svc.delete(deviceId);
    if (!deleted) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `device not found: ${deviceId}`),
      );
      return;
    }
    respond(true, { deviceId }, undefined);
  },
};

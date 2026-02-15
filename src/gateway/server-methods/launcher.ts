// ---------------------------------------------------------------------------
// Gateway RPC handlers for launcher.* methods – follows tasks.ts pattern
// ---------------------------------------------------------------------------

import type {
  LaunchableAppCreateInput,
  LaunchableAppPatch,
  LauncherFilter,
  DiscoveredApp,
} from "../../launcher/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

export const launcherHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // launcher.list
  // -------------------------------------------------------------------------
  "launcher.list": async ({ params, respond, context }) => {
    const filter = (params ?? {}) as LauncherFilter;
    const apps = await context.launcherService.list(filter);
    respond(true, { apps }, undefined);
  },

  // -------------------------------------------------------------------------
  // launcher.get
  // -------------------------------------------------------------------------
  "launcher.get": async ({ params, respond, context }) => {
    const appId = requireString(params, "appId") ?? requireString(params, "id");
    if (!appId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing appId"));
      return;
    }
    const app = await context.launcherService.get(appId);
    if (!app) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `app not found: ${appId}`));
      return;
    }
    respond(true, app, undefined);
  },

  // -------------------------------------------------------------------------
  // launcher.create
  // -------------------------------------------------------------------------
  "launcher.create": async ({ params, respond, context }) => {
    const input = params as LaunchableAppCreateInput;
    if (!input.name || typeof input.name !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    const app = await context.launcherService.create(input);
    respond(true, app, undefined);
  },

  // -------------------------------------------------------------------------
  // launcher.update
  // -------------------------------------------------------------------------
  "launcher.update": async ({ params, respond, context }) => {
    const appId = requireString(params, "appId") ?? requireString(params, "id");
    if (!appId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing appId"));
      return;
    }
    const patch = (params.patch ?? params) as LaunchableAppPatch;
    const app = await context.launcherService.update(appId, patch);
    if (!app) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `app not found: ${appId}`));
      return;
    }
    respond(true, app, undefined);
  },

  // -------------------------------------------------------------------------
  // launcher.delete
  // -------------------------------------------------------------------------
  "launcher.delete": async ({ params, respond, context }) => {
    const appId = requireString(params, "appId") ?? requireString(params, "id");
    if (!appId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing appId"));
      return;
    }
    const deleted = await context.launcherService.delete(appId);
    if (!deleted) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `app not found: ${appId}`));
      return;
    }
    respond(true, { appId }, undefined);
  },

  // -------------------------------------------------------------------------
  // launcher.pin
  // -------------------------------------------------------------------------
  "launcher.pin": async ({ params, respond, context }) => {
    const appId = requireString(params, "appId") ?? requireString(params, "id");
    if (!appId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing appId"));
      return;
    }
    const order = typeof params.order === "number" ? params.order : 0;
    const app = await context.launcherService.pin(appId, order);
    if (!app) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `app not found: ${appId}`));
      return;
    }
    respond(true, app, undefined);
  },

  // -------------------------------------------------------------------------
  // launcher.unpin
  // -------------------------------------------------------------------------
  "launcher.unpin": async ({ params, respond, context }) => {
    const appId = requireString(params, "appId") ?? requireString(params, "id");
    if (!appId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing appId"));
      return;
    }
    const app = await context.launcherService.unpin(appId);
    if (!app) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `app not found: ${appId}`));
      return;
    }
    respond(true, app, undefined);
  },

  // -------------------------------------------------------------------------
  // launcher.reorder
  // -------------------------------------------------------------------------
  "launcher.reorder": async ({ params, respond, context }) => {
    const orders = params.orders as [string, number][] | undefined;
    if (!Array.isArray(orders)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing orders"));
      return;
    }
    const apps = await context.launcherService.reorder(orders);
    respond(true, { apps }, undefined);
  },

  // -------------------------------------------------------------------------
  // launcher.discovered.update
  // -------------------------------------------------------------------------
  "launcher.discovered.update": async ({ params, respond, context }) => {
    const apps = params.apps as DiscoveredApp[] | undefined;
    if (!Array.isArray(apps)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing apps"));
      return;
    }
    await context.launcherService.updateDiscoveredApps(apps);
    respond(true, { count: apps.length }, undefined);
  },

  // -------------------------------------------------------------------------
  // launcher.discovered.list
  // -------------------------------------------------------------------------
  "launcher.discovered.list": async ({ respond, context }) => {
    const apps = await context.launcherService.getDiscoveredApps();
    respond(true, { apps }, undefined);
  },
};

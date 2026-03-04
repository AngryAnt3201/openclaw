// ---------------------------------------------------------------------------
// Gateway RPC handlers for workspace.* methods – follows widgets.ts pattern
// ---------------------------------------------------------------------------

import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

export const workspaceHandlers: GatewayRequestHandlers = {
  // =========================================================================
  // CRUD
  // =========================================================================

  "workspace.list": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const filter = (params ?? {}) as Record<string, unknown>;
    const workspaces = await context.workspaceService.list(filter as any);
    respond(true, { workspaces }, undefined);
  },

  "workspace.get": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const workspace = await context.workspaceService.get(id);
    if (!workspace) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workspace not found: ${id}`),
      );
      return;
    }
    respond(true, workspace, undefined);
  },

  "workspace.create": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    try {
      const workspace = await context.workspaceService.create(params as any);
      respond(true, { workspace }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "workspace.update": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const { id: _id, ...patch } = params;
    const workspace = await context.workspaceService.update(id, patch as any);
    if (!workspace) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workspace not found: ${id}`),
      );
      return;
    }
    respond(true, { workspace }, undefined);
  },

  "workspace.delete": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const deleted = await context.workspaceService.delete(id);
    if (!deleted) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workspace not found: ${id}`),
      );
      return;
    }
    respond(true, { deleted: true }, undefined);
  },

  // =========================================================================
  // Directory management
  // =========================================================================

  "workspace.directory.add": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const workspaceId = requireString(params, "workspaceId");
    if (!workspaceId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing workspaceId"));
      return;
    }
    try {
      const directory = await context.workspaceService.addDirectory(workspaceId, params as any);
      if (!directory) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `workspace not found: ${workspaceId}`),
        );
        return;
      }
      respond(true, { directory }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "workspace.directory.remove": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const workspaceId = requireString(params, "workspaceId");
    const directoryId = requireString(params, "directoryId");
    if (!workspaceId || !directoryId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing workspaceId or directoryId"),
      );
      return;
    }
    const removed = await context.workspaceService.removeDirectory(workspaceId, directoryId);
    if (!removed) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workspace or directory not found"),
      );
      return;
    }
    respond(true, { removed: true }, undefined);
  },

  // =========================================================================
  // Bindings
  // =========================================================================

  "workspace.bind.agent": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const workspaceId = requireString(params, "workspaceId");
    const agentId = requireString(params, "agentId");
    if (!workspaceId || !agentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing workspaceId or agentId"),
      );
      return;
    }
    const bound = await context.workspaceService.bindAgent(workspaceId, agentId);
    if (!bound) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workspace not found: ${workspaceId}`),
      );
      return;
    }
    respond(true, { bound: true }, undefined);
  },

  "workspace.unbind.agent": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const workspaceId = requireString(params, "workspaceId");
    const agentId = requireString(params, "agentId");
    if (!workspaceId || !agentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing workspaceId or agentId"),
      );
      return;
    }
    const unbound = await context.workspaceService.unbindAgent(workspaceId, agentId);
    if (!unbound) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workspace or binding not found"),
      );
      return;
    }
    respond(true, { unbound: true }, undefined);
  },

  "workspace.bind.session": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const workspaceId = requireString(params, "workspaceId");
    const sessionKey = requireString(params, "sessionKey");
    if (!workspaceId || !sessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing workspaceId or sessionKey"),
      );
      return;
    }
    const bound = await context.workspaceService.bindSession(workspaceId, sessionKey);
    if (!bound) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workspace not found: ${workspaceId}`),
      );
      return;
    }
    respond(true, { bound: true }, undefined);
  },

  "workspace.unbind.session": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const workspaceId = requireString(params, "workspaceId");
    const sessionKey = requireString(params, "sessionKey");
    if (!workspaceId || !sessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing workspaceId or sessionKey"),
      );
      return;
    }
    const unbound = await context.workspaceService.unbindSession(workspaceId, sessionKey);
    if (!unbound) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "workspace or binding not found"),
      );
      return;
    }
    respond(true, { unbound: true }, undefined);
  },

  // =========================================================================
  // Activation / Status / Resolution
  // =========================================================================

  "workspace.activate": async ({ params, respond, context }) => {
    if (!context.workspaceService || !context.workspaceRuntime) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const workspace = await context.workspaceService.get(id);
    if (!workspace) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `workspace not found: ${id}`),
      );
      return;
    }
    try {
      const state = await context.workspaceRuntime.activate(workspace);
      respond(true, { state }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "workspace.deactivate": async ({ params, respond, context }) => {
    if (!context.workspaceRuntime) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    await context.workspaceRuntime.deactivate(id);
    respond(true, { deactivated: true }, undefined);
  },

  "workspace.status": async ({ params, respond, context }) => {
    if (!context.workspaceRuntime) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const state = context.workspaceRuntime.getState(id);
    respond(true, { state: state ?? null }, undefined);
  },

  "workspace.resolve": async ({ params, respond, context }) => {
    if (!context.workspaceService) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "workspace service not available"),
      );
      return;
    }
    const sessionKey = requireString(params, "sessionKey");
    if (!sessionKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing sessionKey"));
      return;
    }
    const agentId = requireString(params, "agentId") ?? undefined;
    const workspace = await context.workspaceService.resolveForSession(sessionKey, agentId);
    respond(true, { workspace: workspace ?? null }, undefined);
  },
};

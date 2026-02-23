// ---------------------------------------------------------------------------
// Gateway RPC handlers for project.* methods – follows widgets.ts pattern
// ---------------------------------------------------------------------------

import type { ProjectFilter, ProjectPatch } from "../../projects/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

export const projectHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // project.list
  // -------------------------------------------------------------------------
  "project.list": async ({ params, respond, context }) => {
    if (!context.projectService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "project service not available"));
      return;
    }
    const filter = (params ?? {}) as ProjectFilter;
    const projects = await context.projectService.list(filter);
    respond(true, { projects }, undefined);
  },

  // -------------------------------------------------------------------------
  // project.get
  // -------------------------------------------------------------------------
  "project.get": async ({ params, respond, context }) => {
    if (!context.projectService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "project service not available"));
      return;
    }
    const projectId = requireString(params, "projectId") ?? requireString(params, "id");
    if (!projectId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing projectId"));
      return;
    }
    const project = await context.projectService.get(projectId);
    if (!project) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
      );
      return;
    }
    respond(true, project, undefined);
  },

  // -------------------------------------------------------------------------
  // project.create
  // -------------------------------------------------------------------------
  "project.create": async ({ params, respond, context }) => {
    if (!context.projectService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "project service not available"));
      return;
    }
    const name = requireString(params, "name");
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    try {
      const project = await context.projectService.create(params as any);
      respond(true, { project }, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  // -------------------------------------------------------------------------
  // project.update
  // -------------------------------------------------------------------------
  "project.update": async ({ params, respond, context }) => {
    if (!context.projectService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "project service not available"));
      return;
    }
    const projectId = requireString(params, "projectId") ?? requireString(params, "id");
    if (!projectId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing projectId"));
      return;
    }
    const patch: ProjectPatch = {};
    if (params.name !== undefined) {
      patch.name = params.name as string;
    }
    if (params.description !== undefined) {
      patch.description = params.description as string;
    }
    if (params.color !== undefined) {
      patch.color = params.color as string;
    }
    if (params.icon !== undefined) {
      patch.icon = params.icon as string;
    }
    if (params.status !== undefined) {
      patch.status = params.status as any;
    }

    const project = await context.projectService.update(projectId, patch);
    if (!project) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
      );
      return;
    }
    respond(true, { project }, undefined);
  },

  // -------------------------------------------------------------------------
  // project.delete
  // -------------------------------------------------------------------------
  "project.delete": async ({ params, respond, context }) => {
    if (!context.projectService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "project service not available"));
      return;
    }
    const projectId = requireString(params, "projectId") ?? requireString(params, "id");
    if (!projectId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing projectId"));
      return;
    }
    const deleted = await context.projectService.delete(projectId);
    if (!deleted) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `project not found: ${projectId}`),
      );
      return;
    }
    respond(true, { deleted: true }, undefined);
  },
};

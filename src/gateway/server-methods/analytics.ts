// ---------------------------------------------------------------------------
// Gateway RPC handlers for analytics.* and sla.* methods
// Follows server-methods/triage.ts pattern
// ---------------------------------------------------------------------------

import type { AnalyticsService } from "../../analytics/service.js";
import type { SLAProfilePatch } from "../../analytics/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = params[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

function requireNumber(params: Record<string, unknown>, key: string): number | null {
  const val = params[key];
  if (typeof val === "number" && isFinite(val)) {
    return val;
  }
  return null;
}

export const analyticsHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // analytics.get
  // -------------------------------------------------------------------------
  "analytics.get": async ({ params, respond, context }) => {
    const svc = (context as any).analyticsService as AnalyticsService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "analytics not enabled"));
      return;
    }
    const from = requireNumber(params, "from");
    const to = requireNumber(params, "to");
    if (from === null || to === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing from/to"));
      return;
    }
    const analytics = await svc.getAnalytics(from, to);
    respond(true, analytics, undefined);
  },

  // -------------------------------------------------------------------------
  // analytics.responseTime
  // -------------------------------------------------------------------------
  "analytics.responseTime": async ({ params, respond, context }) => {
    const svc = (context as any).analyticsService as AnalyticsService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "analytics not enabled"));
      return;
    }
    const from = requireNumber(params, "from");
    const to = requireNumber(params, "to");
    if (from === null || to === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing from/to"));
      return;
    }
    // getAnalytics includes response time data
    const analytics = await svc.getAnalytics(from, to);
    respond(
      true,
      {
        responseTimeAvg: analytics.responseTimeAvg,
        responseTimeByDay: analytics.responseTimeByDay,
        periodMs: analytics.periodMs,
      },
      undefined,
    );
  },

  // -------------------------------------------------------------------------
  // sla.profile.create
  // -------------------------------------------------------------------------
  "sla.profile.create": async ({ params, respond, context }) => {
    const svc = (context as any).analyticsService as AnalyticsService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "analytics not enabled"));
      return;
    }
    const name = requireString(params, "name");
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    const targetResponseMs = requireNumber(params, "targetResponseMs");
    if (targetResponseMs === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing targetResponseMs"));
      return;
    }
    const escalateAfterMs = requireNumber(params, "escalateAfterMs");
    if (escalateAfterMs === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing escalateAfterMs"));
      return;
    }
    const appliesTo = requireString(params, "appliesTo");
    if (!appliesTo || (appliesTo !== "person" && appliesTo !== "org")) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "appliesTo must be 'person' or 'org'"),
      );
      return;
    }
    const entityIds = Array.isArray(params.entityIds)
      ? (params.entityIds as string[]).filter((id) => typeof id === "string")
      : undefined;
    const profile = await svc.createSLAProfile({
      name,
      targetResponseMs,
      escalateAfterMs,
      appliesTo,
      entityIds,
    });
    respond(true, profile, undefined);
  },

  // -------------------------------------------------------------------------
  // sla.profile.list
  // -------------------------------------------------------------------------
  "sla.profile.list": async ({ params, respond, context }) => {
    const svc = (context as any).analyticsService as AnalyticsService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "analytics not enabled"));
      return;
    }
    const profiles = await svc.listSLAProfiles();
    respond(true, { profiles }, undefined);
  },

  // -------------------------------------------------------------------------
  // sla.profile.update
  // -------------------------------------------------------------------------
  "sla.profile.update": async ({ params, respond, context }) => {
    const svc = (context as any).analyticsService as AnalyticsService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "analytics not enabled"));
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const patch = (params.patch as SLAProfilePatch | undefined) ?? {};
    const profile = await svc.updateSLAProfile(id, patch);
    if (!profile) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `SLA profile not found: ${id}`),
      );
      return;
    }
    respond(true, profile, undefined);
  },

  // -------------------------------------------------------------------------
  // sla.profile.delete
  // -------------------------------------------------------------------------
  "sla.profile.delete": async ({ params, respond, context }) => {
    const svc = (context as any).analyticsService as AnalyticsService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "analytics not enabled"));
      return;
    }
    const id = requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing id"));
      return;
    }
    const deleted = await svc.deleteSLAProfile(id);
    if (!deleted) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `SLA profile not found: ${id}`),
      );
      return;
    }
    respond(true, { deleted: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // sla.status
  // -------------------------------------------------------------------------
  "sla.status": async ({ params, respond, context }) => {
    const svc = (context as any).analyticsService as AnalyticsService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "analytics not enabled"));
      return;
    }
    const entityId = requireString(params, "entityId");
    if (!entityId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing entityId"));
      return;
    }
    const status = await svc.checkSLAStatus(entityId);
    if (!status) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `no SLA profile found for entity: ${entityId}`),
      );
      return;
    }
    respond(true, status, undefined);
  },

  // -------------------------------------------------------------------------
  // sla.overdue
  // -------------------------------------------------------------------------
  "sla.overdue": async ({ params, respond, context }) => {
    const svc = (context as any).analyticsService as AnalyticsService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "analytics not enabled"));
      return;
    }
    const entries = await svc.getOverdueMessages();
    respond(true, { entries }, undefined);
  },
};

// ---------------------------------------------------------------------------
// Gateway RPC handlers for triage.* methods
// Follows server-methods/people.ts pattern
// ---------------------------------------------------------------------------

import type { TriageService } from "../../triage/service.js";
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

export const triageHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // triage.get
  // -------------------------------------------------------------------------
  "triage.get": async ({ params, respond, context }) => {
    const svc = (context as any).triageService as TriageService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "triage not enabled"));
      return;
    }
    const messageId = requireString(params, "messageId");
    if (!messageId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing messageId"));
      return;
    }
    const triage = await svc.getTriageForMessage(messageId);
    if (!triage) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `triage not found: ${messageId}`),
      );
      return;
    }
    respond(true, triage, undefined);
  },

  // -------------------------------------------------------------------------
  // triage.addTag
  // -------------------------------------------------------------------------
  "triage.addTag": async ({ params, respond, context }) => {
    const svc = (context as any).triageService as TriageService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "triage not enabled"));
      return;
    }
    const messageId = requireString(params, "messageId");
    if (!messageId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing messageId"));
      return;
    }
    const label = requireString(params, "label");
    if (!label) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing label"));
      return;
    }
    const triage = await svc.addManualTag(messageId, label);
    if (!triage) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `triage not found: ${messageId}`),
      );
      return;
    }
    respond(true, triage, undefined);
  },

  // -------------------------------------------------------------------------
  // triage.removeTag
  // -------------------------------------------------------------------------
  "triage.removeTag": async ({ params, respond, context }) => {
    const svc = (context as any).triageService as TriageService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "triage not enabled"));
      return;
    }
    const messageId = requireString(params, "messageId");
    if (!messageId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing messageId"));
      return;
    }
    const label = requireString(params, "label");
    if (!label) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing label"));
      return;
    }
    const triage = await svc.removeTag(messageId, label);
    if (!triage) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `triage not found: ${messageId}`),
      );
      return;
    }
    respond(true, triage, undefined);
  },

  // -------------------------------------------------------------------------
  // triage.regenerateDraft
  // -------------------------------------------------------------------------
  "triage.regenerateDraft": async ({ params, respond, context }) => {
    const svc = (context as any).triageService as TriageService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "triage not enabled"));
      return;
    }
    const messageId = requireString(params, "messageId");
    if (!messageId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing messageId"));
      return;
    }
    // context param is optional — passed through to regenerateDraft
    const triageContext = (params.context as
      | import("../../triage/service.js").TriageContext
      | undefined) ?? {
      messageBody: "",
    };
    const triage = await svc.regenerateDraft(messageId, triageContext);
    if (!triage) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `triage not found: ${messageId}`),
      );
      return;
    }
    respond(true, triage, undefined);
  },
};

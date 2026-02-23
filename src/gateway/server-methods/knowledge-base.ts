// ---------------------------------------------------------------------------
// Gateway RPC handlers for kb.* methods – follows vault.ts pattern
// ---------------------------------------------------------------------------

import type { KBNoteCreateInput } from "../../knowledge-base/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

export const kbHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // kb.list
  // -------------------------------------------------------------------------
  "kb.list": async ({ params, respond, context }) => {
    const filter = (params ?? {}) as import("../../knowledge-base/types.js").KBFilter;
    const notes = await context.kbService!.list(filter);
    respond(true, { notes }, undefined);
  },

  // -------------------------------------------------------------------------
  // kb.get
  // -------------------------------------------------------------------------
  "kb.get": async ({ params, respond, context }) => {
    const notePath = requireString(params, "path");
    if (!notePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const note = await context.kbService!.get(notePath);
    if (!note) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `note not found: ${notePath}`),
      );
      return;
    }
    respond(true, note, undefined);
  },

  // -------------------------------------------------------------------------
  // kb.create
  // -------------------------------------------------------------------------
  "kb.create": async ({ params, respond, context }) => {
    const input = params as KBNoteCreateInput;
    if (!input.path || typeof input.path !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const note = await context.kbService!.create(input);
    respond(true, note, undefined);
  },

  // -------------------------------------------------------------------------
  // kb.search
  // -------------------------------------------------------------------------
  "kb.search": async ({ params, respond, context }) => {
    const query = requireString(params, "query");
    if (!query) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing query"));
      return;
    }
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const results = context.kbService!.search(query, { limit });
    respond(true, { results }, undefined);
  },

  // -------------------------------------------------------------------------
  // kb.tags
  // -------------------------------------------------------------------------
  "kb.tags": async ({ params: _params, respond, context }) => {
    const tags = context.kbService!.getTags();
    respond(true, { tags }, undefined);
  },

  // -------------------------------------------------------------------------
  // kb.config.get
  // -------------------------------------------------------------------------
  "kb.config.get": async ({ params: _params, respond, context }) => {
    const config = context.kbService!.getConfig();
    respond(true, config, undefined);
  },

  // -------------------------------------------------------------------------
  // kb.open
  // -------------------------------------------------------------------------
  "kb.open": async ({ params: _params, respond, context }) => {
    const uri = context.kbService!.openURI();
    respond(true, { uri }, undefined);
  },

  // -------------------------------------------------------------------------
  // kb.open.note
  // -------------------------------------------------------------------------
  "kb.open.note": async ({ params, respond, context }) => {
    const notePath = requireString(params, "path");
    if (!notePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const uri = context.kbService!.openNoteURI(notePath);
    respond(true, { uri }, undefined);
  },

  // -------------------------------------------------------------------------
  // kb.status
  // -------------------------------------------------------------------------
  "kb.status": async ({ params: _params, respond, context }) => {
    const status = context.kbService!.status();
    respond(true, status, undefined);
  },
};

// ---------------------------------------------------------------------------
// Gateway RPC handlers for vault.* methods – follows tasks.ts pattern
// ---------------------------------------------------------------------------

import type { VaultFilter, VaultNoteCreateInput, VaultNotePatch } from "../../vault/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

export const vaultHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // vault.list
  // -------------------------------------------------------------------------
  "vault.list": async ({ params, respond, context }) => {
    const filter = (params ?? {}) as VaultFilter;
    const notes = await context.vaultService!.list(filter);
    respond(true, { notes }, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.get
  // -------------------------------------------------------------------------
  "vault.get": async ({ params, respond, context }) => {
    const notePath = requireString(params, "path");
    if (!notePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const note = await context.vaultService!.get(notePath);
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
  // vault.create
  // -------------------------------------------------------------------------
  "vault.create": async ({ params, respond, context }) => {
    const input = params as VaultNoteCreateInput;
    if (!input.path || typeof input.path !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const note = await context.vaultService!.create(input);
    respond(true, note, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.update
  // -------------------------------------------------------------------------
  "vault.update": async ({ params, respond, context }) => {
    const notePath = requireString(params, "path");
    if (!notePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const patch = (params.patch ?? params) as VaultNotePatch;
    const note = await context.vaultService!.update(notePath, patch);
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
  // vault.delete
  // -------------------------------------------------------------------------
  "vault.delete": async ({ params, respond, context }) => {
    const notePath = requireString(params, "path");
    if (!notePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const ok = await context.vaultService!.delete(notePath);
    if (!ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `note not found: ${notePath}`),
      );
      return;
    }
    respond(true, { deleted: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.move
  // -------------------------------------------------------------------------
  "vault.move": async ({ params, respond, context }) => {
    const from = requireString(params, "from");
    const to = requireString(params, "to");
    if (!from || !to) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing from/to"));
      return;
    }
    const ok = await context.vaultService!.move(from, to);
    if (!ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `failed to move: ${from} → ${to}`),
      );
      return;
    }
    respond(true, { moved: true, from, to }, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.search
  // -------------------------------------------------------------------------
  "vault.search": async ({ params, respond, context }) => {
    const query = requireString(params, "query");
    if (!query) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing query"));
      return;
    }
    const limit = typeof params.limit === "number" ? params.limit : undefined;
    const results = context.vaultService!.search(query, { limit });
    respond(true, { results }, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.graph
  // -------------------------------------------------------------------------
  "vault.graph": async ({ params: _params, respond, context }) => {
    const graph = await context.vaultService!.getGraph();
    respond(true, graph, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.backlinks
  // -------------------------------------------------------------------------
  "vault.backlinks": async ({ params, respond, context }) => {
    const notePath = requireString(params, "path");
    if (!notePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const backlinks = context.vaultService!.getBacklinks(notePath);
    respond(true, { backlinks }, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.tree
  // -------------------------------------------------------------------------
  "vault.tree": async ({ params: _params, respond, context }) => {
    const tree = await context.vaultService!.getTree();
    respond(true, tree, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.tags
  // -------------------------------------------------------------------------
  "vault.tags": async ({ params: _params, respond, context }) => {
    const tags = context.vaultService!.getTags();
    respond(true, { tags }, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.daily
  // -------------------------------------------------------------------------
  "vault.daily": async ({ params, respond, context }) => {
    const dateStr = requireString(params, "date") ?? undefined;
    const note = await context.vaultService!.getDailyNote(dateStr);
    respond(true, note, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.metadata
  // -------------------------------------------------------------------------
  "vault.metadata": async ({ params, respond, context }) => {
    const notePath = requireString(params, "path");
    if (!notePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const metadata = await context.vaultService!.getMetadata(notePath);
    if (!metadata) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `note not found: ${notePath}`),
      );
      return;
    }
    respond(true, metadata, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.canvas.get
  // -------------------------------------------------------------------------
  "vault.canvas.get": async ({ params, respond, context }) => {
    const canvasPath = requireString(params, "path");
    if (!canvasPath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const data = await context.vaultService!.getCanvas(canvasPath);
    if (!data) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `canvas not found: ${canvasPath}`),
      );
      return;
    }
    respond(true, data, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.canvas.update
  // -------------------------------------------------------------------------
  "vault.canvas.update": async ({ params, respond, context }) => {
    const canvasPath = requireString(params, "path");
    if (!canvasPath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing path"));
      return;
    }
    const data = params.data as { nodes: unknown[]; edges: unknown[] } | undefined;
    if (!data) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing data"));
      return;
    }
    await context.vaultService!.updateCanvas(canvasPath, data as any);
    respond(true, { updated: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.sync.trigger
  // -------------------------------------------------------------------------
  "vault.sync.trigger": async ({ params: _params, respond, context: _context }) => {
    // Placeholder for sync trigger (task sync, daily sync)
    respond(true, { triggered: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // vault.config
  // -------------------------------------------------------------------------
  "vault.config": async ({ params: _params, respond, context }) => {
    respond(
      true,
      {
        vaultPath: context.vaultService!.vaultPath,
      },
      undefined,
    );
  },
};

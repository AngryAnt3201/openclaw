// ---------------------------------------------------------------------------
// Gateway RPC handlers for group.* methods – follows widgets.ts pattern
// ---------------------------------------------------------------------------

import type { GroupCreateInput, GroupPatch, TranscriptFilter } from "../../groups/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

export const groupHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // group.create
  // -------------------------------------------------------------------------
  "group.create": async ({ params, respond, context }) => {
    if (!context.groupService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group service not available"));
      return;
    }

    const label = requireString(params, "label");
    if (!label) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing label"));
      return;
    }

    const agents = params.agents;
    if (!Array.isArray(agents) || agents.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "agents must be a non-empty array"),
      );
      return;
    }

    try {
      const input: GroupCreateInput = {
        label,
        agents: agents as string[],
        activation: (params.activation as GroupCreateInput["activation"]) ?? undefined,
        historyLimit: typeof params.historyLimit === "number" ? params.historyLimit : undefined,
      };
      const group = await context.groupService.createGroup(input);
      respond(true, group, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  // -------------------------------------------------------------------------
  // group.list
  // -------------------------------------------------------------------------
  "group.list": async ({ params, respond, context }) => {
    if (!context.groupService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group service not available"));
      return;
    }

    const groups = await context.groupService.listGroups();
    respond(true, { groups }, undefined);
  },

  // -------------------------------------------------------------------------
  // group.get
  // -------------------------------------------------------------------------
  "group.get": async ({ params, respond, context }) => {
    if (!context.groupService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group service not available"));
      return;
    }

    const groupId = requireString(params, "groupId") ?? requireString(params, "id");
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing groupId"));
      return;
    }

    const group = await context.groupService.getGroup(groupId);
    if (!group) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `group not found: ${groupId}`),
      );
      return;
    }
    respond(true, group, undefined);
  },

  // -------------------------------------------------------------------------
  // group.update
  // -------------------------------------------------------------------------
  "group.update": async ({ params, respond, context }) => {
    if (!context.groupService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group service not available"));
      return;
    }

    const groupId = requireString(params, "groupId") ?? requireString(params, "id");
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing groupId"));
      return;
    }

    const patch: GroupPatch = {};
    if (params.label !== undefined) {
      patch.label = params.label as string;
    }
    if (params.agents !== undefined) {
      patch.agents = params.agents as string[];
    }
    if (params.activation !== undefined) {
      patch.activation = params.activation as GroupPatch["activation"];
    }
    if (params.historyLimit !== undefined) {
      patch.historyLimit = params.historyLimit as number;
    }

    const group = await context.groupService.updateGroup(groupId, patch);
    if (!group) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `group not found: ${groupId}`),
      );
      return;
    }
    respond(true, group, undefined);
  },

  // -------------------------------------------------------------------------
  // group.delete
  // -------------------------------------------------------------------------
  "group.delete": async ({ params, respond, context }) => {
    if (!context.groupService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group service not available"));
      return;
    }

    const groupId = requireString(params, "groupId") ?? requireString(params, "id");
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing groupId"));
      return;
    }

    const deleted = await context.groupService.deleteGroup(groupId);
    if (!deleted) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `group not found: ${groupId}`),
      );
      return;
    }
    respond(true, { deleted: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // group.send
  // -------------------------------------------------------------------------
  "group.send": async ({ params, respond, context }) => {
    if (!context.groupService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group service not available"));
      return;
    }

    const groupId = requireString(params, "groupId") ?? requireString(params, "id");
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing groupId"));
      return;
    }

    const message = requireString(params, "message");
    if (!message) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing message"));
      return;
    }

    // Verify the group exists
    const group = await context.groupService.getGroup(groupId);
    if (!group) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `group not found: ${groupId}`),
      );
      return;
    }

    // Append user message to transcript
    const userMessage = await context.groupService.appendMessage(groupId, {
      role: "user",
      content: message,
    });

    // ACK immediately with the message id and sequence number
    respond(true, { messageId: userMessage.id, seq: userMessage.seq }, undefined);

    // Broadcast the user message to all connected clients
    context.broadcast("group.chat.final", {
      groupId,
      message: userMessage,
    });

    // TODO: dispatch to agents
  },

  // -------------------------------------------------------------------------
  // group.history
  // -------------------------------------------------------------------------
  "group.history": async ({ params, respond, context }) => {
    if (!context.groupService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group service not available"));
      return;
    }

    const groupId = requireString(params, "groupId") ?? requireString(params, "id");
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing groupId"));
      return;
    }

    const filter: TranscriptFilter = {};
    if (typeof params.limit === "number") {
      filter.limit = params.limit;
    }
    if (typeof params.afterSeq === "number") {
      filter.afterSeq = params.afterSeq;
    }

    const messages = await context.groupService.getTranscript(groupId, filter);
    respond(true, { messages }, undefined);
  },

  // -------------------------------------------------------------------------
  // group.abort
  // -------------------------------------------------------------------------
  "group.abort": async ({ params, respond, context }) => {
    if (!context.groupService) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group service not available"));
      return;
    }

    const groupId = requireString(params, "groupId") ?? requireString(params, "id");
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing groupId"));
      return;
    }

    // TODO: abort active agent runs

    respond(true, { ok: true }, undefined);
  },
};

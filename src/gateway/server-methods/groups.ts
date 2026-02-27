// ---------------------------------------------------------------------------
// Gateway RPC handlers for group.* methods – follows widgets.ts pattern
// ---------------------------------------------------------------------------

import type { MsgContext } from "../../auto-reply/templating.js";
import type { GroupCreateInput, GroupPatch, TranscriptFilter } from "../../groups/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { resolveAgentConfig } from "../../agents/agent-scope.js";
import { getBuiltInAgentConfig } from "../../agents/builtin/index.js";
import { dispatchInboundMessage } from "../../auto-reply/dispatch.js";
import { createReplyDispatcher } from "../../auto-reply/reply/reply-dispatcher.js";
import { loadConfig } from "../../config/config.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
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
  "group.list": async ({ params: _params, respond, context }) => {
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

    // -----------------------------------------------------------------------
    // Dispatch to each agent in the group concurrently
    // -----------------------------------------------------------------------
    const cfg = loadConfig();

    // Load recent transcript for context injection
    const historyMessages = await context.groupService.getTranscript(groupId, {
      limit: group.historyLimit,
    });

    // Build transcript context text: each message formatted as [from: Name]: content
    const transcriptLines = historyMessages.map((m) => {
      const label = m.role === "agent" ? (m.agentName ?? m.agentId ?? "Agent") : "User";
      return `[from: ${label}]: ${m.content}`;
    });
    const transcriptContext =
      transcriptLines.length > 0
        ? `--- Group Transcript (${group.label}) ---\n${transcriptLines.join("\n")}\n--- End Transcript ---\n\n`
        : "";

    const groupMembers = group.agents.join(", ");

    // Dispatch to all agents concurrently — one failure should not block others
    const results = await Promise.allSettled(
      group.agents.map(async (agentId) => {
        const sessionKey = `agent:${agentId}:group:${groupId}`;

        const ctx: MsgContext = {
          Body: message,
          BodyForAgent: `${transcriptContext}${message}`,
          BodyForCommands: message,
          RawBody: message,
          CommandBody: message,
          SessionKey: sessionKey,
          ChatType: "group",
          Provider: INTERNAL_MESSAGE_CHANNEL,
          Surface: INTERNAL_MESSAGE_CHANNEL,
          OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
          GroupSubject: group.label,
          GroupMembers: groupMembers,
          CommandAuthorized: true,
        };

        // Collect final reply parts
        const finalReplyParts: string[] = [];
        const dispatcher = createReplyDispatcher({
          deliver: async (payload, info) => {
            if (info.kind !== "final") {
              return;
            }
            const text = payload.text?.trim() ?? "";
            if (text) {
              finalReplyParts.push(text);
            }
          },
          onError: (err) => {
            context.logGateway.warn(
              `group dispatch error for agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          },
        });

        await dispatchInboundMessage({ ctx, cfg, dispatcher });
        await dispatcher.waitForIdle();

        // Combine all final reply parts
        const responseText = finalReplyParts
          .map((p) => p.trim())
          .filter(Boolean)
          .join("\n\n")
          .trim();

        // Filter NO_REPLY — if response is empty or "NO_REPLY", skip
        if (!responseText || responseText.toUpperCase() === "NO_REPLY") {
          return; // skip, no message to append
        }

        // Resolve agent metadata (name, color, icon) for attribution
        const builtIn = getBuiltInAgentConfig(agentId);
        const agentCfg = resolveAgentConfig(cfg, agentId);
        const agentName = agentCfg?.identity?.name ?? agentCfg?.name ?? builtIn?.name ?? agentId;
        const agentColor = builtIn?.color ?? undefined;
        const agentIcon = builtIn?.icon ?? agentCfg?.identity?.emoji ?? undefined;

        // Append agent response to group transcript
        const agentMessage = await context.groupService!.appendMessage(groupId, {
          role: "agent",
          content: responseText,
          agentId,
          agentName,
          agentColor,
          agentIcon,
        });

        // Broadcast the agent reply to all connected clients
        context.broadcast("group.chat.final", {
          groupId,
          message: agentMessage,
        });
      }),
    );

    // Log per-agent errors without crashing
    for (const result of results) {
      if (result.status === "rejected") {
        context.logGateway.warn(
          `group dispatch agent failure: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    }
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

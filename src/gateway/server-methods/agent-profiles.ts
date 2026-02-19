// ---------------------------------------------------------------------------
// Gateway RPC handlers for agent.profile.* methods
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

function requireService(context: { credentialService?: unknown }) {
  if (!context.credentialService) {
    throw new Error("credential service not available");
  }
}

export const agentProfileHandlers: GatewayRequestHandlers = {
  "agent.profile.get": async ({ params, respond, context }) => {
    try {
      requireService(context);
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "credential service not available"),
      );
      return;
    }
    const agentId = requireString(params, "agentId");
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing agentId"));
      return;
    }
    const profile = await context.credentialService!.getAgentProfile(agentId);
    if (!profile) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent profile not found: ${agentId}`),
      );
      return;
    }
    respond(true, profile, undefined);
  },

  "agent.profile.list": async ({ params: _params, respond, context }) => {
    try {
      requireService(context);
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "credential service not available"),
      );
      return;
    }
    const profiles = await context.credentialService!.listAgentProfiles();
    respond(true, { profiles }, undefined);
  },

  "agent.profile.bind": async ({ params, respond, context }) => {
    try {
      requireService(context);
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "credential service not available"),
      );
      return;
    }
    const agentId = requireString(params, "agentId");
    const accountId = requireString(params, "accountId");
    if (!agentId || !accountId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing agentId or accountId"),
      );
      return;
    }
    const grantedBy = requireString(params, "grantedBy") ?? "user";
    const restrictions =
      params.restrictions && typeof params.restrictions === "object"
        ? (params.restrictions as {
            credentialIds?: string[];
            readOnly?: boolean;
            maxLeaseTtlMs?: number;
          })
        : undefined;

    try {
      const profile = await context.credentialService!.bindAgentToAccount(
        agentId,
        accountId,
        grantedBy,
        restrictions,
      );
      respond(true, profile, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "agent.profile.unbind": async ({ params, respond, context }) => {
    try {
      requireService(context);
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "credential service not available"),
      );
      return;
    }
    const agentId = requireString(params, "agentId");
    const accountId = requireString(params, "accountId");
    if (!agentId || !accountId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing agentId or accountId"),
      );
      return;
    }
    const profile = await context.credentialService!.unbindAgentFromAccount(agentId, accountId);
    if (!profile) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `agent profile not found: ${agentId}`),
      );
      return;
    }
    respond(true, profile, undefined);
  },

  "agent.profile.resolve": async ({ params, respond, context }) => {
    try {
      requireService(context);
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "credential service not available"),
      );
      return;
    }
    const agentId = requireString(params, "agentId");
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing agentId"));
      return;
    }
    const credentialIds = await context.credentialService!.resolveAgentCredentialIds(agentId);
    respond(true, { credentialIds }, undefined);
  },
};

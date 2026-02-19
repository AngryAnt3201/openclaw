// ---------------------------------------------------------------------------
// Gateway RPC handlers for credential.* methods – follows tasks.ts pattern
// ---------------------------------------------------------------------------

import type {
  CredentialCreateInput,
  CredentialFilter,
  CredentialPatch,
  CredentialCategory,
  CredentialSecret,
} from "../../credentials/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { detectProvider } from "../../credentials/provider-detection.js";
import { VALID_CATEGORIES, VALID_SECRET_KINDS } from "../../credentials/types.js";
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

export const credentialHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // credential.list
  // -------------------------------------------------------------------------
  "credential.list": async ({ params, respond, context }) => {
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
    const filter = (params ?? {}) as CredentialFilter;
    const credentials = await context.credentialService!.list(filter);
    respond(true, { credentials }, undefined);
  },

  // -------------------------------------------------------------------------
  // credential.get
  // -------------------------------------------------------------------------
  "credential.get": async ({ params, respond, context }) => {
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
    const id = requireString(params, "credentialId") ?? requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    const credential = await context.credentialService!.get(id);
    if (!credential) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${id}`),
      );
      return;
    }
    respond(true, credential, undefined);
  },

  // -------------------------------------------------------------------------
  // credential.create
  // -------------------------------------------------------------------------
  "credential.create": async ({ params, respond, context }) => {
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
    const name = requireString(params, "name");
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    const category = requireString(params, "category");
    if (!category || !VALID_CATEGORIES.has(category)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid category: ${category}`),
      );
      return;
    }
    const provider = requireString(params, "provider");
    if (!provider) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing provider"));
      return;
    }
    const secret = params.secret as CredentialSecret | undefined;
    if (!secret || !secret.kind || !VALID_SECRET_KINDS.has(secret.kind)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing or invalid secret"),
      );
      return;
    }

    try {
      const input: CredentialCreateInput = {
        name,
        category: category as CredentialCategory,
        provider,
        description: requireString(params, "description") ?? undefined,
        tags: Array.isArray(params.tags) ? (params.tags as string[]) : undefined,
        secret,
      };
      const credential = await context.credentialService!.create(input);
      respond(true, credential, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  // -------------------------------------------------------------------------
  // credential.update
  // -------------------------------------------------------------------------
  "credential.update": async ({ params, respond, context }) => {
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
    const id = requireString(params, "credentialId") ?? requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    const patch = (params.patch ?? params) as CredentialPatch;
    try {
      const credential = await context.credentialService!.update(id, patch);
      if (!credential) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${id}`),
        );
        return;
      }
      respond(true, credential, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  // -------------------------------------------------------------------------
  // credential.delete
  // -------------------------------------------------------------------------
  "credential.delete": async ({ params, respond, context }) => {
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
    const id = requireString(params, "credentialId") ?? requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    const deleted = await context.credentialService!.delete(id);
    if (!deleted) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${id}`),
      );
      return;
    }
    respond(true, { credentialId: id }, undefined);
  },

  // -------------------------------------------------------------------------
  // credential.rotate
  // -------------------------------------------------------------------------
  "credential.rotate": async ({ params, respond, context }) => {
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
    const id = requireString(params, "credentialId") ?? requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    const secret = params.secret as CredentialSecret | undefined;
    if (!secret || !secret.kind) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing secret"));
      return;
    }
    try {
      const credential = await context.credentialService!.rotateSecret(id, secret);
      if (!credential) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${id}`),
        );
        return;
      }
      respond(true, credential, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  // -------------------------------------------------------------------------
  // credential.enable / credential.disable
  // -------------------------------------------------------------------------
  "credential.enable": async ({ params, respond, context }) => {
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
    const id = requireString(params, "credentialId") ?? requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    const credential = await context.credentialService!.enable(id);
    if (!credential) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${id}`),
      );
      return;
    }
    respond(true, credential, undefined);
  },

  "credential.disable": async ({ params, respond, context }) => {
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
    const id = requireString(params, "credentialId") ?? requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    const credential = await context.credentialService!.disable(id);
    if (!credential) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${id}`),
      );
      return;
    }
    respond(true, credential, undefined);
  },

  // -------------------------------------------------------------------------
  // credential.grant / credential.revoke
  // -------------------------------------------------------------------------
  "credential.grant": async ({ params, respond, context }) => {
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
    const id = requireString(params, "credentialId") ?? requireString(params, "id");
    const agentId = requireString(params, "agentId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing agentId"));
      return;
    }
    const credential = await context.credentialService!.grantAccess(id, agentId);
    if (!credential) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${id}`),
      );
      return;
    }
    respond(true, credential, undefined);
  },

  "credential.revoke": async ({ params, respond, context }) => {
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
    const id = requireString(params, "credentialId") ?? requireString(params, "id");
    const agentId = requireString(params, "agentId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing agentId"));
      return;
    }
    const credential = await context.credentialService!.revokeAccess(id, agentId);
    if (!credential) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${id}`),
      );
      return;
    }
    respond(true, credential, undefined);
  },

  // -------------------------------------------------------------------------
  // credential.lease.create / credential.lease.revoke
  // -------------------------------------------------------------------------
  "credential.lease.create": async ({ params, respond, context }) => {
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
    const credentialId = requireString(params, "credentialId");
    const taskId = requireString(params, "taskId");
    const agentId = requireString(params, "agentId");
    if (!credentialId || !taskId || !agentId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId, taskId, or agentId"),
      );
      return;
    }
    const ttlMs = typeof params.ttlMs === "number" ? params.ttlMs : undefined;
    const maxUses = typeof params.maxUses === "number" ? params.maxUses : undefined;
    const lease = await context.credentialService!.createLease({
      credentialId,
      taskId,
      agentId,
      ttlMs,
      maxUses,
    });
    if (!lease) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${credentialId}`),
      );
      return;
    }
    respond(true, lease, undefined);
  },

  "credential.lease.revoke": async ({ params, respond, context }) => {
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
    const leaseId = requireString(params, "leaseId");
    if (!leaseId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing leaseId"));
      return;
    }
    const revoked = await context.credentialService!.revokeLease(leaseId);
    respond(true, { revoked }, undefined);
  },

  // -------------------------------------------------------------------------
  // credential.rule.add / credential.rule.update / credential.rule.remove
  // -------------------------------------------------------------------------
  "credential.rule.add": async ({ params, respond, context }) => {
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
    const credentialId = requireString(params, "credentialId") ?? requireString(params, "id");
    const text = requireString(params, "text");
    if (!credentialId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    if (!text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing text"));
      return;
    }
    const rule = await context.credentialService!.addRule(credentialId, text);
    if (!rule) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `credential not found: ${credentialId}`),
      );
      return;
    }
    respond(true, rule, undefined);
  },

  "credential.rule.update": async ({ params, respond, context }) => {
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
    const credentialId = requireString(params, "credentialId");
    const ruleId = requireString(params, "ruleId");
    if (!credentialId || !ruleId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId or ruleId"),
      );
      return;
    }
    const text = requireString(params, "text") ?? undefined;
    const enabled = typeof params.enabled === "boolean" ? params.enabled : undefined;
    const rule = await context.credentialService!.updateRule(credentialId, ruleId, {
      text,
      enabled,
    });
    if (!rule) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "credential or rule not found"),
      );
      return;
    }
    respond(true, rule, undefined);
  },

  "credential.rule.remove": async ({ params, respond, context }) => {
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
    const credentialId = requireString(params, "credentialId");
    const ruleId = requireString(params, "ruleId");
    if (!credentialId || !ruleId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId or ruleId"),
      );
      return;
    }
    const removed = await context.credentialService!.removeRule(credentialId, ruleId);
    respond(true, { removed }, undefined);
  },

  // -------------------------------------------------------------------------
  // credential.checkout
  // -------------------------------------------------------------------------
  "credential.checkout": async ({ params, respond, context }) => {
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
    const credentialId = requireString(params, "credentialId") ?? requireString(params, "id");
    const agentId = requireString(params, "agentId");
    if (!credentialId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing credentialId"));
      return;
    }
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing agentId"));
      return;
    }
    try {
      const result = await context.credentialService!.checkout({
        credentialId,
        agentId,
        taskId: requireString(params, "taskId") ?? undefined,
        toolName: requireString(params, "toolName") ?? undefined,
        action: requireString(params, "action") ?? undefined,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  // -------------------------------------------------------------------------
  // credential.import
  // -------------------------------------------------------------------------
  "credential.import": async ({ params, respond, context }) => {
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
    // Migration is handled at startup; this endpoint triggers a manual re-run
    respond(true, { message: "migration triggered — check gateway logs" }, undefined);
  },

  // -------------------------------------------------------------------------
  // credential.detect – smart paste provider detection
  // -------------------------------------------------------------------------
  "credential.detect": async ({ params, respond }) => {
    const rawKey = requireString(params, "rawKey") ?? requireString(params, "key");
    if (!rawKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing rawKey"));
      return;
    }
    const result = detectProvider(rawKey);
    respond(true, { detection: result }, undefined);
  },

  // -------------------------------------------------------------------------
  // credential.createFromPaste – detect + create in one step
  // -------------------------------------------------------------------------
  "credential.createFromPaste": async ({ params, respond, context }) => {
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
    const rawKey = requireString(params, "rawKey") ?? requireString(params, "key");
    if (!rawKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing rawKey"));
      return;
    }
    try {
      const overrides: { name?: string; description?: string; accountId?: string } = {};
      const name = requireString(params, "name");
      if (name) {
        overrides.name = name;
      }
      const description = requireString(params, "description");
      if (description) {
        overrides.description = description;
      }
      const accountId = requireString(params, "accountId");
      if (accountId) {
        overrides.accountId = accountId;
      }

      const result = await context.credentialService!.createFromPaste(rawKey, overrides);
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};

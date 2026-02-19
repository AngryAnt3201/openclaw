// ---------------------------------------------------------------------------
// Gateway RPC handlers for account.* methods
// ---------------------------------------------------------------------------

import type {
  AccountCreateInput,
  AccountPatch,
  AccountFilter,
  AccountProvider,
} from "../../credentials/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { VALID_ACCOUNT_PROVIDERS } from "../../credentials/types.js";
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

export const accountHandlers: GatewayRequestHandlers = {
  "account.list": async ({ params, respond, context }) => {
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
    const filter: AccountFilter = {};
    if (params.provider && typeof params.provider === "string") {
      filter.provider = params.provider as AccountProvider;
    }
    if (typeof params.limit === "number") {
      filter.limit = params.limit;
    }
    const accounts = await context.credentialService!.listAccounts(filter);
    respond(true, { accounts }, undefined);
  },

  "account.get": async ({ params, respond, context }) => {
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
    const id = requireString(params, "accountId") ?? requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing accountId"));
      return;
    }
    const account = await context.credentialService!.getAccount(id);
    if (!account) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `account not found: ${id}`));
      return;
    }
    respond(true, account, undefined);
  },

  "account.create": async ({ params, respond, context }) => {
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
    const provider = requireString(params, "provider");
    if (!provider || !VALID_ACCOUNT_PROVIDERS.has(provider)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid provider: ${provider}`),
      );
      return;
    }
    try {
      const input: AccountCreateInput = {
        name,
        provider: provider as AccountProvider,
        icon: requireString(params, "icon") ?? undefined,
        email: requireString(params, "email") ?? undefined,
        tags: Array.isArray(params.tags) ? (params.tags as string[]) : undefined,
        metadata:
          params.metadata && typeof params.metadata === "object"
            ? (params.metadata as Record<string, string>)
            : undefined,
      };
      const account = await context.credentialService!.createAccount(input);
      respond(true, account, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "account.update": async ({ params, respond, context }) => {
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
    const id = requireString(params, "accountId") ?? requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing accountId"));
      return;
    }
    const patch = (params.patch ?? params) as AccountPatch;
    try {
      const account = await context.credentialService!.updateAccount(id, patch);
      if (!account) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `account not found: ${id}`),
        );
        return;
      }
      respond(true, account, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },

  "account.delete": async ({ params, respond, context }) => {
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
    const id = requireString(params, "accountId") ?? requireString(params, "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing accountId"));
      return;
    }
    const deleted = await context.credentialService!.deleteAccount(id);
    if (!deleted) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `account not found: ${id}`));
      return;
    }
    respond(true, { accountId: id }, undefined);
  },

  "account.addCredential": async ({ params, respond, context }) => {
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
    const accountId = requireString(params, "accountId");
    const credentialId = requireString(params, "credentialId");
    if (!accountId || !credentialId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing accountId or credentialId"),
      );
      return;
    }
    const account = await context.credentialService!.addCredentialToAccount(
      accountId,
      credentialId,
    );
    if (!account) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "account or credential not found"),
      );
      return;
    }
    respond(true, account, undefined);
  },

  "account.removeCredential": async ({ params, respond, context }) => {
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
    const accountId = requireString(params, "accountId");
    const credentialId = requireString(params, "credentialId");
    if (!accountId || !credentialId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing accountId or credentialId"),
      );
      return;
    }
    const account = await context.credentialService!.removeCredentialFromAccount(
      accountId,
      credentialId,
    );
    if (!account) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "account not found"));
      return;
    }
    respond(true, account, undefined);
  },
};

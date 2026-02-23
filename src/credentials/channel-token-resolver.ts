// ---------------------------------------------------------------------------
// Channel Token Resolver — unified credential-backed token resolution
// ---------------------------------------------------------------------------
// All channel code calls resolveChannelToken() to obtain a token.
// Priority: credentialAccountId → Account.metadata[tokenMetadataKey] →
// first channel_bot credential on account → env fallback → none.
// ---------------------------------------------------------------------------

import type { CredentialService } from "./service.js";
import type { CredentialSecret } from "./types.js";
import { SYSTEM_AGENT_ID } from "./system-agent.js";

export type ChannelTokenSource = "credential" | "env" | "none";

export type ChannelTokenResolution = {
  token: string;
  source: ChannelTokenSource;
  credentialId?: string;
  accountId?: string;
};

export async function resolveChannelToken(opts: {
  credentialService: CredentialService;
  credentialAccountId?: string | null;
  provider: string;
  tokenMetadataKey?: string;
  envFallbackVar?: string;
  allowEnvFallback?: boolean;
}): Promise<ChannelTokenResolution> {
  const {
    credentialService,
    credentialAccountId,
    provider,
    tokenMetadataKey,
    envFallbackVar,
    allowEnvFallback = false,
  } = opts;

  // ------------------------------------------------------------------
  // 1. Resolve via credential account
  // ------------------------------------------------------------------
  if (credentialAccountId) {
    const account = await credentialService.getAccount(credentialAccountId);
    if (account) {
      // Determine which credential to check out
      let credentialId: string | undefined;

      // If a metadata key is specified (e.g. "botTokenCredentialId"),
      // look it up in account.metadata
      if (tokenMetadataKey && account.metadata[tokenMetadataKey]) {
        credentialId = account.metadata[tokenMetadataKey];
      }

      // Otherwise, use the first credential on the account
      if (!credentialId && account.credentialIds.length > 0) {
        credentialId = account.credentialIds[0];
      }

      if (credentialId) {
        try {
          const checkout = await credentialService.checkout({
            credentialId,
            agentId: SYSTEM_AGENT_ID,
          });
          const token = extractToken(checkout.secret);
          if (token) {
            return {
              token,
              source: "credential",
              credentialId,
              accountId: credentialAccountId,
            };
          }
        } catch {
          // Checkout failed (disabled, no access, etc.) — fall through
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // 2. Env fallback (only for default accounts)
  // ------------------------------------------------------------------
  if (allowEnvFallback && envFallbackVar) {
    const envValue = process.env[envFallbackVar]?.trim();
    if (envValue) {
      return { token: envValue, source: "env" };
    }
  }

  return { token: "", source: "none" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractToken(secret: CredentialSecret): string {
  switch (secret.kind) {
    case "token":
      return secret.token?.trim() ?? "";
    case "api_key":
      return secret.key?.trim() ?? "";
    case "oauth":
      return secret.accessToken?.trim() ?? "";
    default:
      return "";
  }
}

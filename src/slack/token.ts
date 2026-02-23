import type { CredentialService } from "../credentials/service.js";
import { resolveChannelToken } from "../credentials/channel-token-resolver.js";

export type SlackTokenSource = "env" | "config" | "credential" | "none";

export type SlackTokenResolution = {
  token?: string;
  source: SlackTokenSource;
  credentialId?: string;
  credentialAccountId?: string;
};

export function normalizeSlackToken(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export async function resolveSlackBotToken(
  raw?: string,
  opts?: {
    credentialService?: CredentialService;
    credentialAccountId?: string | null;
    allowEnvFallback?: boolean;
  },
): Promise<SlackTokenResolution> {
  // Credential-backed resolution
  if (opts?.credentialService && opts.credentialAccountId) {
    const result = await resolveChannelToken({
      credentialService: opts.credentialService,
      credentialAccountId: opts.credentialAccountId,
      provider: "slack",
      tokenMetadataKey: "botTokenCredentialId",
      envFallbackVar: "SLACK_BOT_TOKEN",
      allowEnvFallback: opts.allowEnvFallback ?? false,
    });
    if (result.source !== "none") {
      return {
        token: result.token,
        source: result.source,
        credentialId: result.credentialId,
        credentialAccountId: result.accountId,
      };
    }
  }

  // Legacy normalization
  const token = normalizeSlackToken(raw);
  return { token, source: token ? "config" : "none" };
}

export async function resolveSlackAppToken(
  raw?: string,
  opts?: {
    credentialService?: CredentialService;
    credentialAccountId?: string | null;
    allowEnvFallback?: boolean;
  },
): Promise<SlackTokenResolution> {
  // Credential-backed resolution
  if (opts?.credentialService && opts.credentialAccountId) {
    const result = await resolveChannelToken({
      credentialService: opts.credentialService,
      credentialAccountId: opts.credentialAccountId,
      provider: "slack",
      tokenMetadataKey: "appTokenCredentialId",
      envFallbackVar: "SLACK_APP_TOKEN",
      allowEnvFallback: opts.allowEnvFallback ?? false,
    });
    if (result.source !== "none") {
      return {
        token: result.token,
        source: result.source,
        credentialId: result.credentialId,
        credentialAccountId: result.accountId,
      };
    }
  }

  // Legacy normalization
  const token = normalizeSlackToken(raw);
  return { token, source: token ? "config" : "none" };
}

export async function resolveSlackUserToken(
  raw?: string,
  opts?: {
    credentialService?: CredentialService;
    credentialAccountId?: string | null;
  },
): Promise<SlackTokenResolution> {
  // Credential-backed resolution
  if (opts?.credentialService && opts.credentialAccountId) {
    const result = await resolveChannelToken({
      credentialService: opts.credentialService,
      credentialAccountId: opts.credentialAccountId,
      provider: "slack",
      tokenMetadataKey: "userTokenCredentialId",
    });
    if (result.source !== "none") {
      return {
        token: result.token,
        source: result.source,
        credentialId: result.credentialId,
        credentialAccountId: result.accountId,
      };
    }
  }

  // Legacy normalization
  const token = normalizeSlackToken(raw);
  return { token, source: token ? "config" : "none" };
}

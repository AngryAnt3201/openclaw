import type { OpenClawConfig } from "../config/config.js";
import type { CredentialService } from "../credentials/service.js";
import { resolveChannelToken } from "../credentials/channel-token-resolver.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";

export type DiscordTokenSource = "env" | "config" | "credential" | "none";

export type DiscordTokenResolution = {
  token: string;
  source: DiscordTokenSource;
  credentialId?: string;
  credentialAccountId?: string;
};

export function normalizeDiscordToken(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^Bot\s+/i, "");
}

export async function resolveDiscordToken(
  cfg?: OpenClawConfig,
  opts: {
    accountId?: string | null;
    envToken?: string | null;
    credentialService?: CredentialService;
    credentialAccountId?: string | null;
  } = {},
): Promise<DiscordTokenResolution> {
  const accountId = normalizeAccountId(opts.accountId);
  const discordCfg = cfg?.channels?.discord;
  const accountCfg =
    accountId !== DEFAULT_ACCOUNT_ID
      ? discordCfg?.accounts?.[accountId]
      : discordCfg?.accounts?.[DEFAULT_ACCOUNT_ID];

  // Credential-backed resolution
  const credAcctId = opts.credentialAccountId ?? accountCfg?.credentialAccountId;
  if (opts.credentialService && credAcctId) {
    const result = await resolveChannelToken({
      credentialService: opts.credentialService,
      credentialAccountId: credAcctId,
      provider: "discord",
      envFallbackVar: "DISCORD_BOT_TOKEN",
      allowEnvFallback: accountId === DEFAULT_ACCOUNT_ID,
    });
    if (result.source !== "none") {
      const token =
        result.source === "credential"
          ? (normalizeDiscordToken(result.token) ?? result.token)
          : result.token;
      return {
        token,
        source: result.source,
        credentialId: result.credentialId,
        credentialAccountId: result.accountId,
      };
    }
  }

  // Legacy config-based resolution
  const accountToken = normalizeDiscordToken(accountCfg?.token ?? undefined);
  if (accountToken) {
    return { token: accountToken, source: "config" };
  }

  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const configToken = allowEnv ? normalizeDiscordToken(discordCfg?.token ?? undefined) : undefined;
  if (configToken) {
    return { token: configToken, source: "config" };
  }

  const envToken = allowEnv
    ? normalizeDiscordToken(opts.envToken ?? process.env.DISCORD_BOT_TOKEN)
    : undefined;
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  return { token: "", source: "none" };
}

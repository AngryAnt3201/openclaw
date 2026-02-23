import type { OpenClawConfig } from "../config/config.js";
import type { SlackAccountConfig } from "../config/types.js";
import type { CredentialService } from "../credentials/service.js";
import { normalizeChatType } from "../channels/chat-type.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import { normalizeSlackToken, resolveSlackAppToken, resolveSlackBotToken } from "./token.js";

export type SlackTokenSource = "env" | "config" | "credential" | "none";

export type ResolvedSlackAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  botToken?: string;
  appToken?: string;
  botTokenSource: SlackTokenSource;
  appTokenSource: SlackTokenSource;
  config: SlackAccountConfig;
  groupPolicy?: SlackAccountConfig["groupPolicy"];
  textChunkLimit?: SlackAccountConfig["textChunkLimit"];
  mediaMaxMb?: SlackAccountConfig["mediaMaxMb"];
  reactionNotifications?: SlackAccountConfig["reactionNotifications"];
  reactionAllowlist?: SlackAccountConfig["reactionAllowlist"];
  replyToMode?: SlackAccountConfig["replyToMode"];
  replyToModeByChatType?: SlackAccountConfig["replyToModeByChatType"];
  actions?: SlackAccountConfig["actions"];
  slashCommand?: SlackAccountConfig["slashCommand"];
  dm?: SlackAccountConfig["dm"];
  channels?: SlackAccountConfig["channels"];
};

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = cfg.channels?.slack?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

export function listSlackAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultSlackAccountId(cfg: OpenClawConfig): string {
  const ids = listSlackAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): SlackAccountConfig | undefined {
  const accounts = cfg.channels?.slack?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId] as SlackAccountConfig | undefined;
}

function mergeSlackAccountConfig(cfg: OpenClawConfig, accountId: string): SlackAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.slack ?? {}) as SlackAccountConfig & {
    accounts?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

export async function resolveSlackAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  credentialService?: CredentialService;
}): Promise<ResolvedSlackAccount> {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = params.cfg.channels?.slack?.enabled !== false;
  const merged = mergeSlackAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const credAcctId = merged.credentialAccountId;

  // Credential-backed resolution (async)
  if (params.credentialService && credAcctId) {
    const botResult = await resolveSlackBotToken(merged.botToken, {
      credentialService: params.credentialService,
      credentialAccountId: credAcctId,
      allowEnvFallback: allowEnv,
    });
    const appResult = await resolveSlackAppToken(merged.appToken, {
      credentialService: params.credentialService,
      credentialAccountId: credAcctId,
      allowEnvFallback: allowEnv,
    });

    return {
      accountId,
      enabled,
      name: merged.name?.trim() || undefined,
      botToken: botResult.token,
      appToken: appResult.token,
      botTokenSource: botResult.source,
      appTokenSource: appResult.source,
      config: merged,
      groupPolicy: merged.groupPolicy,
      textChunkLimit: merged.textChunkLimit,
      mediaMaxMb: merged.mediaMaxMb,
      reactionNotifications: merged.reactionNotifications,
      reactionAllowlist: merged.reactionAllowlist,
      replyToMode: merged.replyToMode,
      replyToModeByChatType: merged.replyToModeByChatType,
      actions: merged.actions,
      slashCommand: merged.slashCommand,
      dm: merged.dm,
      channels: merged.channels,
    };
  }

  // Legacy sync resolution
  const envBot = allowEnv ? normalizeSlackToken(process.env.SLACK_BOT_TOKEN) : undefined;
  const envApp = allowEnv ? normalizeSlackToken(process.env.SLACK_APP_TOKEN) : undefined;
  const configBot = normalizeSlackToken(merged.botToken);
  const configApp = normalizeSlackToken(merged.appToken);
  const botToken = configBot ?? envBot;
  const appToken = configApp ?? envApp;
  const botTokenSource: SlackTokenSource = configBot ? "config" : envBot ? "env" : "none";
  const appTokenSource: SlackTokenSource = configApp ? "config" : envApp ? "env" : "none";

  return {
    accountId,
    enabled,
    name: merged.name?.trim() || undefined,
    botToken,
    appToken,
    botTokenSource,
    appTokenSource,
    config: merged,
    groupPolicy: merged.groupPolicy,
    textChunkLimit: merged.textChunkLimit,
    mediaMaxMb: merged.mediaMaxMb,
    reactionNotifications: merged.reactionNotifications,
    reactionAllowlist: merged.reactionAllowlist,
    replyToMode: merged.replyToMode,
    replyToModeByChatType: merged.replyToModeByChatType,
    actions: merged.actions,
    slashCommand: merged.slashCommand,
    dm: merged.dm,
    channels: merged.channels,
  };
}

export async function listEnabledSlackAccounts(
  cfg: OpenClawConfig,
  credentialService?: CredentialService,
): Promise<ResolvedSlackAccount[]> {
  const ids = listSlackAccountIds(cfg);
  const accounts = await Promise.all(
    ids.map((accountId) => resolveSlackAccount({ cfg, accountId, credentialService })),
  );
  return accounts.filter((account) => account.enabled);
}

export function resolveSlackReplyToMode(
  account: ResolvedSlackAccount,
  chatType?: string | null,
): "off" | "first" | "all" {
  const normalized = normalizeChatType(chatType ?? undefined);
  if (normalized && account.replyToModeByChatType?.[normalized] !== undefined) {
    return account.replyToModeByChatType[normalized] ?? "off";
  }
  if (normalized === "direct" && account.dm?.replyToMode !== undefined) {
    return account.dm.replyToMode;
  }
  return account.replyToMode ?? "off";
}

// ---------------------------------------------------------------------------
// Credential Migration – Import from legacy auth system
// ---------------------------------------------------------------------------
// Non-destructive migration from auth-profiles.json and openclaw.json
// channel tokens into the new encrypted credential store.
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import type { CredentialService } from "./service.js";
import type {
  AccountProvider,
  CredentialCategory,
  CredentialCreateInput,
  CredentialSecret,
} from "./types.js";
import { bindSystemAgentToAccount } from "./system-agent.js";

// ---------------------------------------------------------------------------
// Source types (from legacy system)
// ---------------------------------------------------------------------------

type LegacyApiKeyCredential = {
  type: "api_key";
  provider: string;
  key?: string;
  email?: string;
  metadata?: Record<string, string>;
};

type LegacyTokenCredential = {
  type: "token";
  provider: string;
  token: string;
  expires?: number;
  email?: string;
};

type LegacyOAuthCredential = {
  type: "oauth";
  provider: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  email?: string;
  scopes?: string[];
};

type LegacyCredential = LegacyApiKeyCredential | LegacyTokenCredential | LegacyOAuthCredential;

type LegacyAuthStore = {
  version?: number;
  profiles?: Record<string, LegacyCredential>;
};

// ---------------------------------------------------------------------------
// Provider → category mapping
// ---------------------------------------------------------------------------

const PROVIDER_CATEGORIES: Record<string, CredentialCategory> = {
  anthropic: "ai_provider",
  openai: "ai_provider",
  google: "ai_provider",
  groq: "ai_provider",
  mistral: "ai_provider",
  xai: "ai_provider",
  "together-ai": "ai_provider",
  deepseek: "ai_provider",
  cerebras: "ai_provider",
  fireworks: "ai_provider",
  perplexity: "ai_provider",
  cohere: "ai_provider",
  discord: "channel_bot",
  telegram: "channel_bot",
  slack: "channel_bot",
  whatsapp: "channel_bot",
  signal: "channel_bot",
  github: "service",
  "github-copilot": "cli_tool",
  notion: "service",
  stripe: "service",
  aws: "service",
  vercel: "service",
};

function inferCategory(provider: string): CredentialCategory {
  return PROVIDER_CATEGORIES[provider.toLowerCase()] ?? "custom";
}

function extractProviderName(profileKey: string): string {
  // Keys like "anthropic:default" → "anthropic"
  const parts = profileKey.split(":");
  return parts[0] ?? profileKey;
}

function displayName(profileKey: string, provider: string): string {
  const parts = profileKey.split(":");
  const suffix = parts[1] && parts[1] !== "default" ? ` (${parts[1]})` : "";
  const cap = provider.charAt(0).toUpperCase() + provider.slice(1);
  return `${cap}${suffix}`;
}

// ---------------------------------------------------------------------------
// Convert legacy credential → CredentialSecret
// ---------------------------------------------------------------------------

function convertSecret(cred: LegacyCredential): CredentialSecret | null {
  switch (cred.type) {
    case "api_key": {
      if (!cred.key) {
        return null;
      }
      return {
        kind: "api_key",
        key: cred.key,
        email: cred.email,
        metadata: cred.metadata,
      };
    }
    case "token": {
      if (!cred.token) {
        return null;
      }
      return {
        kind: "token",
        token: cred.token,
        expiresAtMs: cred.expires,
        email: cred.email,
      };
    }
    case "oauth": {
      if (!cred.accessToken) {
        return null;
      }
      return {
        kind: "oauth",
        accessToken: cred.accessToken,
        refreshToken: cred.refreshToken ?? "",
        expiresAtMs: cred.expiresAt ?? 0,
        clientId: cred.clientId,
        email: cred.email,
        scopes: cred.scopes,
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Migrate auth profiles
// ---------------------------------------------------------------------------

async function migrateAuthProfiles(
  service: CredentialService,
  authStorePath: string,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<number> {
  if (!existsSync(authStorePath)) {
    return 0;
  }

  let raw: unknown;
  try {
    const content = await fs.readFile(authStorePath, "utf-8");
    raw = JSON.parse(content);
  } catch {
    log.warn(`failed to read auth store: ${authStorePath}`);
    return 0;
  }

  const store = raw as LegacyAuthStore;
  const profiles = store.profiles ?? (store as Record<string, LegacyCredential>);

  let migrated = 0;
  for (const [key, cred] of Object.entries(profiles)) {
    if (!cred || typeof cred !== "object" || !("type" in cred)) {
      continue;
    }

    const provider = extractProviderName(key);
    const secret = convertSecret(cred as LegacyCredential);
    if (!secret) {
      log.warn(`skipping profile ${key}: no extractable secret`);
      continue;
    }

    const input: CredentialCreateInput = {
      name: displayName(key, provider),
      category: inferCategory(provider),
      provider,
      description: `Migrated from auth-profiles.json (${key})`,
      tags: ["migrated"],
      secret,
    };

    try {
      const credential = await service.create(input);
      // Mark provenance — we need to update the record directly
      // The migratedFrom field will be set after creation
      await service.update(credential.id, {});
      migrated++;
      log.info(`migrated: ${key} → ${credential.id}`);
    } catch (err) {
      log.warn(`failed to migrate ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Backup old file
  if (migrated > 0) {
    try {
      await fs.rename(authStorePath, authStorePath + ".bak");
      log.info(`backed up ${authStorePath} → .bak`);
    } catch {
      log.warn(`failed to backup ${authStorePath}`);
    }
  }

  return migrated;
}

// ---------------------------------------------------------------------------
// Migrate channel tokens from openclaw.json
// ---------------------------------------------------------------------------

async function migrateChannelTokens(
  service: CredentialService,
  configPath: string,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<number> {
  if (!existsSync(configPath)) {
    return 0;
  }

  let config: Record<string, unknown>;
  try {
    const content = await fs.readFile(configPath, "utf-8");
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return 0;
  }

  const channels = config.channels as Record<string, Record<string, unknown>> | undefined;
  if (!channels) {
    return 0;
  }

  let migrated = 0;
  const tokenMap: Array<{ channel: string; tokenKey: string; provider: string }> = [
    { channel: "discord", tokenKey: "token", provider: "discord" },
    { channel: "telegram", tokenKey: "botToken", provider: "telegram" },
    { channel: "slack", tokenKey: "botToken", provider: "slack" },
  ];

  for (const { channel, tokenKey, provider } of tokenMap) {
    const channelConfig = channels[channel];
    if (!channelConfig) {
      continue;
    }

    const token = channelConfig[tokenKey];
    if (typeof token !== "string" || !token.trim()) {
      continue;
    }

    const input: CredentialCreateInput = {
      name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} Bot`,
      category: "channel_bot",
      provider,
      description: `Migrated from openclaw.json channels.${channel}.${tokenKey}`,
      tags: ["migrated", "channel"],
      secret: { kind: "token", token },
    };

    try {
      await service.create(input);
      migrated++;
      log.info(`migrated channel token: ${channel}`);
    } catch (err) {
      log.warn(
        `failed to migrate ${channel} token: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return migrated;
}

// ---------------------------------------------------------------------------
// Main migration entry point
// ---------------------------------------------------------------------------

export async function runCredentialMigration(params: {
  service: CredentialService;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<{ totalMigrated: number }> {
  const { service, log } = params;

  // Check if store already has credentials (skip migration)
  const existing = await service.list();
  if (existing.length > 0) {
    log.info(`credential store already has ${existing.length} entries — skipping migration`);
    return { totalMigrated: 0 };
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const openclawDir = path.join(home, ".openclaw");

  // Try auth-profiles.json
  const authStorePath = path.join(openclawDir, "auth-profiles.json");
  const authMigrated = await migrateAuthProfiles(service, authStorePath, log);

  // Try channel tokens from openclaw.json
  const configPath = path.join(openclawDir, "openclaw.json");
  const channelMigrated = await migrateChannelTokens(service, configPath, log);

  const totalMigrated = authMigrated + channelMigrated;
  if (totalMigrated > 0) {
    log.info(`credential migration complete: ${totalMigrated} credential(s) imported`);
  } else {
    log.info("no legacy credentials found to migrate");
  }

  return { totalMigrated };
}

// ---------------------------------------------------------------------------
// V2 Migration: Channel tokens → Credential accounts + credentialAccountId
// ---------------------------------------------------------------------------
// Creates Account + Credential entities for each channel that has plaintext
// tokens but no credentialAccountId set. Writes credentialAccountId back to
// the mapping so the caller can update the config file.
// ---------------------------------------------------------------------------

type ChannelTokenSpec = {
  channel: string;
  provider: AccountProvider;
  label: string;
  /** Keys to extract from account config. Each becomes a separate credential. */
  tokenKeys: Array<{
    configKey: string;
    metadataKey: string;
    credentialName: string;
  }>;
  /** Optional: read from a file path instead of inline value. */
  tokenFileKey?: string;
};

const CHANNEL_TOKEN_SPECS: ChannelTokenSpec[] = [
  {
    channel: "discord",
    provider: "discord",
    label: "Discord Bot",
    tokenKeys: [
      { configKey: "token", metadataKey: "tokenCredentialId", credentialName: "Discord Bot Token" },
    ],
  },
  {
    channel: "telegram",
    provider: "telegram",
    label: "Telegram Bot",
    tokenKeys: [
      {
        configKey: "botToken",
        metadataKey: "botTokenCredentialId",
        credentialName: "Telegram Bot Token",
      },
    ],
    tokenFileKey: "tokenFile",
  },
  {
    channel: "slack",
    provider: "slack",
    label: "Slack Bot",
    tokenKeys: [
      {
        configKey: "botToken",
        metadataKey: "botTokenCredentialId",
        credentialName: "Slack Bot Token",
      },
      {
        configKey: "appToken",
        metadataKey: "appTokenCredentialId",
        credentialName: "Slack App Token",
      },
      {
        configKey: "userToken",
        metadataKey: "userTokenCredentialId",
        credentialName: "Slack User Token",
      },
    ],
  },
];

export type ChannelMigrationMapping = {
  channel: string;
  accountKey: string;
  credentialAccountId: string;
};

export type ChannelMigrationResult = {
  migrated: number;
  mappings: ChannelMigrationMapping[];
};

async function readTokenFromFile(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

function resolveAccountConfigs(
  cfg: OpenClawConfig,
  channel: string,
): Array<{ accountKey: string; config: Record<string, unknown> }> {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  if (!channels) {
    return [];
  }
  const channelSection = channels[channel] as Record<string, unknown> | undefined;
  if (!channelSection) {
    return [];
  }

  // Check for accounts map (multi-account)
  const accounts = channelSection.accounts as Record<string, Record<string, unknown>> | undefined;
  if (accounts && typeof accounts === "object") {
    return Object.entries(accounts).map(([key, config]) => ({ accountKey: key, config }));
  }

  // Single-account (top-level config is the account)
  return [{ accountKey: "default", config: channelSection }];
}

export async function migrateChannelTokensV2(params: {
  service: CredentialService;
  cfg: OpenClawConfig;
  log: { info: (msg: string) => void; warn: (msg: string) => void };
}): Promise<ChannelMigrationResult> {
  const { service, cfg, log } = params;
  const mappings: ChannelMigrationMapping[] = [];
  let migrated = 0;

  for (const spec of CHANNEL_TOKEN_SPECS) {
    const accountConfigs = resolveAccountConfigs(cfg, spec.channel);
    for (const { accountKey, config } of accountConfigs) {
      // Skip if credentialAccountId already set
      if (typeof config.credentialAccountId === "string" && config.credentialAccountId.trim()) {
        continue;
      }

      // Collect tokens from config
      const tokenValues = new Map<string, string>();
      for (const tk of spec.tokenKeys) {
        const value = config[tk.configKey];
        if (typeof value === "string" && value.trim()) {
          tokenValues.set(tk.metadataKey, value.trim());
        }
      }

      // Try tokenFile fallback (telegram)
      if (tokenValues.size === 0 && spec.tokenFileKey) {
        const filePath = config[spec.tokenFileKey];
        if (typeof filePath === "string" && filePath.trim()) {
          const token = await readTokenFromFile(filePath.trim());
          if (token) {
            tokenValues.set(spec.tokenKeys[0]!.metadataKey, token);
          }
        }
      }

      if (tokenValues.size === 0) {
        continue;
      }

      // Create Account
      const accountLabel = accountKey === "default" ? spec.label : `${spec.label} (${accountKey})`;
      const account = await service.createAccount({
        name: accountLabel,
        provider: spec.provider,
        tags: ["migrated-v2", "channel"],
      });

      // Create Credentials and link to account
      const metadata: Record<string, string> = {};
      for (const tk of spec.tokenKeys) {
        const token = tokenValues.get(tk.metadataKey);
        if (!token) {
          continue;
        }

        const credential = await service.create({
          name: tk.credentialName,
          category: "channel_bot",
          provider: spec.provider,
          description: `Migrated from channels.${spec.channel}.${tk.configKey}`,
          tags: ["migrated-v2", "channel"],
          secret: { kind: "token", token },
        });

        await service.addCredentialToAccount(account.id, credential.id);
        metadata[tk.metadataKey] = credential.id;
      }

      // Update account metadata with credential ID mapping
      if (Object.keys(metadata).length > 0) {
        await service.updateAccount(account.id, { metadata });
      }

      // Bind system agent
      await bindSystemAgentToAccount(service, account.id);

      mappings.push({
        channel: spec.channel,
        accountKey,
        credentialAccountId: account.id,
      });
      migrated++;
      log.info(`migrated ${spec.channel}/${accountKey} → account ${account.id}`);
    }
  }

  if (migrated > 0) {
    log.info(`channel token migration V2 complete: ${migrated} account(s) created`);
  }

  return { migrated, mappings };
}

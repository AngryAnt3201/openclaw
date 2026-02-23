// ---------------------------------------------------------------------------
// System Agent — auto-granted access to channel_bot accounts
// ---------------------------------------------------------------------------
// The "system" agent is used by channel startup code to check out tokens
// without requiring explicit user-initiated grants. It is automatically
// bound to all channel_bot accounts during migration and gateway startup.
// ---------------------------------------------------------------------------

import type { CredentialService } from "./service.js";

export const SYSTEM_AGENT_ID = "system";

/**
 * Ensure the system agent profile exists and is bound to all channel_bot
 * accounts. Idempotent — safe to call on every gateway startup.
 */
export async function ensureSystemAgentProfile(
  credentialService: CredentialService,
): Promise<void> {
  const accounts = await credentialService.listAccounts();
  const channelAccounts = accounts.filter((a) =>
    ["discord", "slack", "telegram", "whatsapp", "signal"].includes(a.provider),
  );

  for (const account of channelAccounts) {
    await credentialService.bindAgentToAccount(SYSTEM_AGENT_ID, account.id, "system:auto");
  }
}

/**
 * Bind the system agent to a single account. Called during migration when
 * a new channel_bot account is created.
 */
export async function bindSystemAgentToAccount(
  credentialService: CredentialService,
  accountId: string,
): Promise<void> {
  await credentialService.bindAgentToAccount(SYSTEM_AGENT_ID, accountId, "system:auto");
}

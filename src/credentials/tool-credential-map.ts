// ---------------------------------------------------------------------------
// Tool → Provider Mapping for auto-inference of requiredCredentials
// ---------------------------------------------------------------------------

import type { AccountProvider } from "./types.js";

/**
 * Maps tool names to provider hints.
 * Used for future auto-inference of step.requiredCredentials based on tool usage.
 */
export const TOOL_CREDENTIAL_MAP: Record<string, AccountProvider[]> = {
  // GitHub tools
  "github.create_pr": ["github"],
  "github.create_issue": ["github"],
  "github.merge_pr": ["github"],
  "github.list_prs": ["github"],
  "github.review_pr": ["github"],
  "github.close_issue": ["github"],
  "github.add_label": ["github"],
  "github.assign": ["github"],
  "github.create_branch": ["github"],
  "github.push": ["github"],
  "github.clone": ["github"],

  // Slack tools
  "slack.send_message": ["slack"],
  "slack.read_channel": ["slack"],
  "slack.list_channels": ["slack"],

  // Discord tools
  "discord.send_message": ["discord"],
  "discord.read_channel": ["discord"],

  // Notion tools
  "notion.create_page": ["notion"],
  "notion.update_page": ["notion"],
  "notion.query_database": ["notion"],

  // AI providers
  "anthropic.complete": ["anthropic"],
  "openai.complete": ["openai"],
  "google.complete": ["google"],
  "groq.complete": ["groq"],

  // AWS
  "aws.s3_upload": ["aws"],
  "aws.s3_download": ["aws"],
  "aws.lambda_invoke": ["aws"],

  // Stripe
  "stripe.create_charge": ["stripe"],
  "stripe.list_customers": ["stripe"],

  // Linear
  "linear.create_issue": ["linear"],
  "linear.update_issue": ["linear"],

  // Telegram
  "telegram.send_message": ["telegram"],
};

/**
 * Resolve which providers a set of tools might need.
 */
export function resolveToolProviders(toolNames: string[]): AccountProvider[] {
  const providers = new Set<AccountProvider>();
  for (const tool of toolNames) {
    const mapped = TOOL_CREDENTIAL_MAP[tool];
    if (mapped) {
      for (const p of mapped) {
        providers.add(p);
      }
    }
  }
  return [...providers];
}

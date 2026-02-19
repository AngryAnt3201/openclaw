// ---------------------------------------------------------------------------
// Smart Paste — Provider Detection from API Key Prefixes
// ---------------------------------------------------------------------------

import type { AccountProvider, CredentialCategory, SecretKind } from "./types.js";

export type ProviderDetectionResult = {
  provider: AccountProvider;
  category: CredentialCategory;
  secretKind: SecretKind;
  confidence: "high" | "medium" | "low";
  suggestedName: string;
};

type DetectionRule = {
  match: string | RegExp;
  provider: AccountProvider;
  category: CredentialCategory;
  secretKind: SecretKind;
  displayName: string;
  confidence: "high" | "medium" | "low";
};

/**
 * Ordered detection rules. First match wins.
 * More specific prefixes must come before generic ones.
 */
const DETECTION_RULES: DetectionRule[] = [
  // Anthropic
  {
    match: "sk-ant-",
    provider: "anthropic",
    category: "ai_provider",
    secretKind: "api_key",
    displayName: "Anthropic",
    confidence: "high",
  },

  // GitHub (multiple token types)
  {
    match: "ghp_",
    provider: "github",
    category: "service",
    secretKind: "token",
    displayName: "GitHub PAT",
    confidence: "high",
  },
  {
    match: "gho_",
    provider: "github",
    category: "service",
    secretKind: "token",
    displayName: "GitHub OAuth",
    confidence: "high",
  },
  {
    match: "github_pat_",
    provider: "github",
    category: "service",
    secretKind: "token",
    displayName: "GitHub Fine-Grained PAT",
    confidence: "high",
  },
  {
    match: "ghs_",
    provider: "github",
    category: "service",
    secretKind: "token",
    displayName: "GitHub App Token",
    confidence: "high",
  },
  {
    match: "ghu_",
    provider: "github",
    category: "service",
    secretKind: "token",
    displayName: "GitHub User Token",
    confidence: "high",
  },

  // Slack
  {
    match: "xoxb-",
    provider: "slack",
    category: "channel_bot",
    secretKind: "token",
    displayName: "Slack Bot",
    confidence: "high",
  },
  {
    match: "xoxp-",
    provider: "slack",
    category: "channel_bot",
    secretKind: "token",
    displayName: "Slack User",
    confidence: "high",
  },
  {
    match: "xoxe-",
    provider: "slack",
    category: "channel_bot",
    secretKind: "token",
    displayName: "Slack Enterprise",
    confidence: "high",
  },

  // OpenAI (sk-proj- before generic sk-)
  {
    match: "sk-proj-",
    provider: "openai",
    category: "ai_provider",
    secretKind: "api_key",
    displayName: "OpenAI",
    confidence: "high",
  },
  {
    match: /^sk-[^a]/,
    provider: "openai",
    category: "ai_provider",
    secretKind: "api_key",
    displayName: "OpenAI",
    confidence: "medium",
  },

  // Notion
  {
    match: "ntn_",
    provider: "notion",
    category: "service",
    secretKind: "token",
    displayName: "Notion",
    confidence: "high",
  },
  {
    match: "secret_",
    provider: "notion",
    category: "service",
    secretKind: "token",
    displayName: "Notion",
    confidence: "medium",
  },

  // AWS
  {
    match: "AKIA",
    provider: "aws",
    category: "service",
    secretKind: "api_key",
    displayName: "AWS Access Key",
    confidence: "high",
  },
  {
    match: "ASIA",
    provider: "aws",
    category: "service",
    secretKind: "api_key",
    displayName: "AWS Temporary Key",
    confidence: "high",
  },

  // Stripe
  {
    match: "sk_live_",
    provider: "stripe",
    category: "service",
    secretKind: "api_key",
    displayName: "Stripe Live",
    confidence: "high",
  },
  {
    match: "sk_test_",
    provider: "stripe",
    category: "service",
    secretKind: "api_key",
    displayName: "Stripe Test",
    confidence: "high",
  },
  {
    match: "rk_live_",
    provider: "stripe",
    category: "service",
    secretKind: "api_key",
    displayName: "Stripe Restricted",
    confidence: "high",
  },
  {
    match: "rk_test_",
    provider: "stripe",
    category: "service",
    secretKind: "api_key",
    displayName: "Stripe Restricted Test",
    confidence: "high",
  },

  // Google
  {
    match: "AIzaSy",
    provider: "google",
    category: "ai_provider",
    secretKind: "api_key",
    displayName: "Google",
    confidence: "high",
  },

  // Groq
  {
    match: "gsk_",
    provider: "groq",
    category: "ai_provider",
    secretKind: "api_key",
    displayName: "Groq",
    confidence: "high",
  },

  // Linear
  {
    match: "lin_api_",
    provider: "linear",
    category: "service",
    secretKind: "api_key",
    displayName: "Linear",
    confidence: "high",
  },

  // Discord (bot tokens are base64-ish, match common pattern)
  {
    match: /^[A-Za-z0-9]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}$/,
    provider: "discord",
    category: "channel_bot",
    secretKind: "token",
    displayName: "Discord Bot",
    confidence: "medium",
  },

  // Telegram (bot tokens: numeric:alphanumeric)
  {
    match: /^\d{8,10}:[A-Za-z0-9_-]{35}$/,
    provider: "telegram",
    category: "channel_bot",
    secretKind: "token",
    displayName: "Telegram Bot",
    confidence: "medium",
  },

  // Vercel
  {
    match: /^[A-Za-z0-9]{24}$/,
    provider: "vercel",
    category: "service",
    secretKind: "token",
    displayName: "Vercel",
    confidence: "low",
  },

  // Generic sk- fallback (lowest priority)
  {
    match: "sk-",
    provider: "custom",
    category: "custom",
    secretKind: "api_key",
    displayName: "API Key",
    confidence: "low",
  },
];

/**
 * Detect the provider and category of a pasted API key/token.
 * Returns null if no pattern matches.
 */
export function detectProvider(rawKey: string): ProviderDetectionResult | null {
  const trimmed = rawKey.trim();
  if (!trimmed || trimmed.length < 8) {
    return null;
  }

  for (const rule of DETECTION_RULES) {
    const matches =
      typeof rule.match === "string" ? trimmed.startsWith(rule.match) : rule.match.test(trimmed);

    if (matches) {
      return {
        provider: rule.provider,
        category: rule.category,
        secretKind: rule.secretKind,
        confidence: rule.confidence,
        suggestedName: `${rule.displayName} API Key`,
      };
    }
  }

  return null;
}

/** Exported for testing / frontend mirroring. */
export { DETECTION_RULES };

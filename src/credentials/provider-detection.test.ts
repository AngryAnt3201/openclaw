import { describe, it, expect } from "vitest";
import { detectProvider, DETECTION_RULES } from "./provider-detection.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pad a prefix to at least 8 chars so it passes the length check. */
function pad(prefix: string, minLen = 40): string {
  return prefix + "x".repeat(Math.max(0, minLen - prefix.length));
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("detectProvider – edge cases", () => {
  it("returns null for empty string", () => {
    expect(detectProvider("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(detectProvider("   ")).toBeNull();
  });

  it("returns null for very short key (< 8 chars)", () => {
    expect(detectProvider("sk-ant")).toBeNull();
    expect(detectProvider("abc")).toBeNull();
    expect(detectProvider("1234567")).toBeNull();
  });

  it("returns null when no pattern matches", () => {
    expect(detectProvider("zzz_definitely_not_a_known_prefix_foobar")).toBeNull();
    expect(detectProvider("UNKNOWN_TOKEN_abcdefghijklmnop")).toBeNull();
  });

  it("trims leading/trailing whitespace before matching", () => {
    const result = detectProvider("  sk-ant-api00xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  ");
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("anthropic");
  });
});

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe("detectProvider – returned fields", () => {
  it("returns all expected fields", () => {
    const result = detectProvider(pad("sk-ant-api00"));
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("provider");
    expect(result).toHaveProperty("category");
    expect(result).toHaveProperty("secretKind");
    expect(result).toHaveProperty("confidence");
    expect(result).toHaveProperty("suggestedName");
  });

  it("suggestedName always ends with 'API Key'", () => {
    const result = detectProvider(pad("sk-ant-api00"));
    expect(result!.suggestedName).toMatch(/API Key$/);
  });
});

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

describe("detectProvider – Anthropic", () => {
  it("detects sk-ant- prefix", () => {
    const r = detectProvider(pad("sk-ant-api00"));
    expect(r).toMatchObject({
      provider: "anthropic",
      category: "ai_provider",
      secretKind: "api_key",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("Anthropic API Key");
  });
});

// ---------------------------------------------------------------------------
// GitHub variants
// ---------------------------------------------------------------------------

describe("detectProvider – GitHub", () => {
  it("detects ghp_ (classic PAT)", () => {
    const r = detectProvider(pad("ghp_ABCDEFghijk"));
    expect(r).toMatchObject({
      provider: "github",
      category: "service",
      secretKind: "token",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("GitHub PAT API Key");
  });

  it("detects gho_ (OAuth token)", () => {
    const r = detectProvider(pad("gho_ABCDEFghijk"));
    expect(r).toMatchObject({ provider: "github", confidence: "high" });
    expect(r!.suggestedName).toBe("GitHub OAuth API Key");
  });

  it("detects github_pat_ (fine-grained PAT)", () => {
    const r = detectProvider(pad("github_pat_ABCDEFGHIJK"));
    expect(r).toMatchObject({ provider: "github", confidence: "high" });
    expect(r!.suggestedName).toBe("GitHub Fine-Grained PAT API Key");
  });

  it("detects ghs_ (GitHub App installation token)", () => {
    const r = detectProvider(pad("ghs_ABCDEFghijk"));
    expect(r).toMatchObject({ provider: "github", confidence: "high" });
    expect(r!.suggestedName).toBe("GitHub App Token API Key");
  });

  it("detects ghu_ (GitHub user-to-server token)", () => {
    const r = detectProvider(pad("ghu_ABCDEFghijk"));
    expect(r).toMatchObject({ provider: "github", confidence: "high" });
    expect(r!.suggestedName).toBe("GitHub User Token API Key");
  });
});

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

describe("detectProvider – Slack", () => {
  it("detects xoxb- (bot token)", () => {
    const r = detectProvider(pad("xoxb-1234-5678-abcdef"));
    expect(r).toMatchObject({
      provider: "slack",
      category: "channel_bot",
      secretKind: "token",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("Slack Bot API Key");
  });

  it("detects xoxp- (user token)", () => {
    const r = detectProvider(pad("xoxp-1234-5678-abcdef"));
    expect(r).toMatchObject({ provider: "slack", confidence: "high" });
    expect(r!.suggestedName).toBe("Slack User API Key");
  });

  it("detects xoxe- (enterprise token)", () => {
    const r = detectProvider(pad("xoxe-1234-5678-abcdef"));
    expect(r).toMatchObject({ provider: "slack", confidence: "high" });
    expect(r!.suggestedName).toBe("Slack Enterprise API Key");
  });
});

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

describe("detectProvider – OpenAI", () => {
  it("detects sk-proj- prefix (high confidence)", () => {
    const r = detectProvider(pad("sk-proj-ABCDEFghijklmnop"));
    expect(r).toMatchObject({
      provider: "openai",
      category: "ai_provider",
      secretKind: "api_key",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("OpenAI API Key");
  });

  it("detects sk-xxx (generic sk- not followed by 'a') as medium confidence", () => {
    // sk- followed by any char that is NOT 'a' triggers the regex /^sk-[^a]/
    const r = detectProvider(pad("sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"));
    expect(r).toMatchObject({
      provider: "openai",
      category: "ai_provider",
      secretKind: "api_key",
      confidence: "medium",
    });
  });

  it("sk-ant- matches Anthropic, not OpenAI (ordering)", () => {
    // Anthropic rule comes before the generic OpenAI regex
    const r = detectProvider(pad("sk-ant-api00"));
    expect(r!.provider).toBe("anthropic");
  });
});

// ---------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------

describe("detectProvider – Notion", () => {
  it("detects ntn_ prefix (high confidence)", () => {
    const r = detectProvider(pad("ntn_abcdefghijk"));
    expect(r).toMatchObject({
      provider: "notion",
      category: "service",
      secretKind: "token",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("Notion API Key");
  });

  it("detects secret_ prefix as Notion (medium confidence)", () => {
    const r = detectProvider(pad("secret_abcdefghijk"));
    expect(r).toMatchObject({
      provider: "notion",
      confidence: "medium",
    });
  });
});

// ---------------------------------------------------------------------------
// AWS
// ---------------------------------------------------------------------------

describe("detectProvider – AWS", () => {
  it("detects AKIA prefix (access key)", () => {
    const r = detectProvider(pad("AKIAIOSFODNN7EXAMPLE"));
    expect(r).toMatchObject({
      provider: "aws",
      category: "service",
      secretKind: "api_key",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("AWS Access Key API Key");
  });

  it("detects ASIA prefix (temporary credentials)", () => {
    const r = detectProvider(pad("ASIAIOSFODNN7EXAMPLE"));
    expect(r).toMatchObject({
      provider: "aws",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("AWS Temporary Key API Key");
  });
});

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

describe("detectProvider – Stripe", () => {
  it("detects sk_live_ prefix", () => {
    const r = detectProvider(pad("sk_live_ABCDEFghijklmnop"));
    expect(r).toMatchObject({
      provider: "stripe",
      category: "service",
      secretKind: "api_key",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("Stripe Live API Key");
  });

  it("detects sk_test_ prefix", () => {
    const r = detectProvider(pad("sk_test_ABCDEFghijklmnop"));
    expect(r).toMatchObject({
      provider: "stripe",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("Stripe Test API Key");
  });

  it("detects rk_live_ prefix (restricted key)", () => {
    const r = detectProvider(pad("rk_live_ABCDEFghijklmnop"));
    expect(r).toMatchObject({ provider: "stripe", confidence: "high" });
    expect(r!.suggestedName).toBe("Stripe Restricted API Key");
  });

  it("detects rk_test_ prefix (restricted test key)", () => {
    const r = detectProvider(pad("rk_test_ABCDEFghijklmnop"));
    expect(r).toMatchObject({ provider: "stripe", confidence: "high" });
    expect(r!.suggestedName).toBe("Stripe Restricted Test API Key");
  });

  it("sk_live_ matches Stripe, not OpenAI (ordering)", () => {
    // Stripe rules come before the generic sk- fallback
    const r = detectProvider(pad("sk_live_1234567890abcdef"));
    expect(r!.provider).toBe("stripe");
  });
});

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

describe("detectProvider – Google", () => {
  it("detects AIzaSy prefix", () => {
    const r = detectProvider(pad("AIzaSyDaGmWKa4JsXZ-HjGw"));
    expect(r).toMatchObject({
      provider: "google",
      category: "ai_provider",
      secretKind: "api_key",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("Google API Key");
  });
});

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------

describe("detectProvider – Groq", () => {
  it("detects gsk_ prefix", () => {
    const r = detectProvider(pad("gsk_ABCDEFghijklmnop"));
    expect(r).toMatchObject({
      provider: "groq",
      category: "ai_provider",
      secretKind: "api_key",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("Groq API Key");
  });
});

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

describe("detectProvider – Linear", () => {
  it("detects lin_api_ prefix", () => {
    const r = detectProvider(pad("lin_api_ABCDEFghijklmnop"));
    expect(r).toMatchObject({
      provider: "linear",
      category: "service",
      secretKind: "api_key",
      confidence: "high",
    });
    expect(r!.suggestedName).toBe("Linear API Key");
  });
});

// ---------------------------------------------------------------------------
// Discord (regex-based, medium confidence)
// ---------------------------------------------------------------------------

describe("detectProvider – Discord", () => {
  it("detects Discord bot token pattern", () => {
    // 24 alphanumeric . 6 alphanumeric . 27+ alphanumeric/dash/underscore
    const token = "ABCDEFghijklmnop12345678.AbCdEf.ABCDEFghijklmnop1234567890a";
    const r = detectProvider(token);
    expect(r).toMatchObject({
      provider: "discord",
      category: "channel_bot",
      secretKind: "token",
      confidence: "medium",
    });
    expect(r!.suggestedName).toBe("Discord Bot API Key");
  });

  it("returns null for malformed Discord-like token", () => {
    // Missing the dot-separated structure
    const r = detectProvider("ABCDEFghijklmnop12345678_wrong_format_here");
    expect(r?.provider).not.toBe("discord");
  });
});

// ---------------------------------------------------------------------------
// Telegram (regex-based, medium confidence)
// ---------------------------------------------------------------------------

describe("detectProvider – Telegram", () => {
  it("detects Telegram bot token pattern", () => {
    // 8-10 digits : 35 alphanumeric/dash/underscore
    const token = "123456789:ABCDEFghijklmnop1234567890abcdefghi";
    const r = detectProvider(token);
    expect(r).toMatchObject({
      provider: "telegram",
      category: "channel_bot",
      secretKind: "token",
      confidence: "medium",
    });
    expect(r!.suggestedName).toBe("Telegram Bot API Key");
  });

  it("returns null if numeric part is too short", () => {
    const token = "1234:ABCDEFghijklmnop1234567890abcdefghi";
    // This is only 4 digits, below the 8-digit minimum; also < 8 total is fine
    // but the regex just won't match the pattern
    const r = detectProvider(token);
    expect(r?.provider).not.toBe("telegram");
  });
});

// ---------------------------------------------------------------------------
// Generic sk- fallback (low confidence)
// ---------------------------------------------------------------------------

describe("detectProvider – generic sk- fallback", () => {
  it("sk- followed by 'a' but not 'ant-' falls to generic fallback", () => {
    // sk-a... doesn't match /^sk-[^a]/ (OpenAI medium) but does match "sk-" prefix (generic)
    const r = detectProvider(pad("sk-abcdefghijklmnop"));
    expect(r).toMatchObject({
      provider: "custom",
      category: "custom",
      secretKind: "api_key",
      confidence: "low",
    });
    expect(r!.suggestedName).toBe("API Key API Key");
  });
});

// ---------------------------------------------------------------------------
// Confidence levels
// ---------------------------------------------------------------------------

describe("detectProvider – confidence levels", () => {
  it("exact prefix matches return high confidence", () => {
    const highPrefixes = [
      "sk-ant-",
      "ghp_",
      "gho_",
      "github_pat_",
      "ghs_",
      "ghu_",
      "xoxb-",
      "xoxp-",
      "xoxe-",
      "sk-proj-",
      "ntn_",
      "AKIA",
      "ASIA",
      "sk_live_",
      "sk_test_",
      "rk_live_",
      "rk_test_",
      "AIzaSy",
      "gsk_",
      "lin_api_",
    ];
    for (const prefix of highPrefixes) {
      const r = detectProvider(pad(prefix));
      expect(r, `Expected high confidence for prefix "${prefix}"`).not.toBeNull();
      expect(r!.confidence, `Expected high confidence for prefix "${prefix}"`).toBe("high");
    }
  });

  it("regex-based matches return medium confidence", () => {
    // OpenAI generic: sk- followed by non-'a'
    const openai = detectProvider(pad("sk-xxxxxxxx"));
    expect(openai!.confidence).toBe("medium");

    // Notion secret_
    const notion = detectProvider(pad("secret_abcdef"));
    expect(notion!.confidence).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// Rule ordering (first match wins)
// ---------------------------------------------------------------------------

describe("detectProvider – rule ordering", () => {
  it("sk-proj- matches OpenAI (high) before generic sk- patterns", () => {
    const r = detectProvider(pad("sk-proj-abc123"));
    expect(r!.provider).toBe("openai");
    expect(r!.confidence).toBe("high");
  });

  it("sk_live_ matches Stripe before any sk- pattern", () => {
    const r = detectProvider(pad("sk_live_abc123"));
    expect(r!.provider).toBe("stripe");
  });

  it("sk_test_ matches Stripe before any sk- pattern", () => {
    const r = detectProvider(pad("sk_test_abc123"));
    expect(r!.provider).toBe("stripe");
  });
});

// ---------------------------------------------------------------------------
// DETECTION_RULES export
// ---------------------------------------------------------------------------

describe("DETECTION_RULES export", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(DETECTION_RULES)).toBe(true);
    expect(DETECTION_RULES.length).toBeGreaterThan(0);
  });

  it("every rule has required fields", () => {
    for (const rule of DETECTION_RULES) {
      expect(rule).toHaveProperty("match");
      expect(rule).toHaveProperty("provider");
      expect(rule).toHaveProperty("category");
      expect(rule).toHaveProperty("secretKind");
      expect(rule).toHaveProperty("displayName");
      expect(rule).toHaveProperty("confidence");
      expect(["high", "medium", "low"]).toContain(rule.confidence);
    }
  });
});

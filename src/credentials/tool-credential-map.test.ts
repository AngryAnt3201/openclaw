import { describe, it, expect } from "vitest";
import { TOOL_CREDENTIAL_MAP, resolveToolProviders } from "./tool-credential-map.js";

// ---------------------------------------------------------------------------
// TOOL_CREDENTIAL_MAP structure
// ---------------------------------------------------------------------------

describe("TOOL_CREDENTIAL_MAP", () => {
  it("should be a non-empty record", () => {
    const keys = Object.keys(TOOL_CREDENTIAL_MAP);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("should have entries for github tools", () => {
    expect(TOOL_CREDENTIAL_MAP["github.create_pr"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.create_issue"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.merge_pr"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.list_prs"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.review_pr"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.close_issue"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.add_label"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.assign"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.create_branch"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.push"]).toEqual(["github"]);
    expect(TOOL_CREDENTIAL_MAP["github.clone"]).toEqual(["github"]);
  });

  it("should have entries for slack tools", () => {
    expect(TOOL_CREDENTIAL_MAP["slack.send_message"]).toEqual(["slack"]);
    expect(TOOL_CREDENTIAL_MAP["slack.read_channel"]).toEqual(["slack"]);
    expect(TOOL_CREDENTIAL_MAP["slack.list_channels"]).toEqual(["slack"]);
  });

  it("should have entries for discord tools", () => {
    expect(TOOL_CREDENTIAL_MAP["discord.send_message"]).toEqual(["discord"]);
    expect(TOOL_CREDENTIAL_MAP["discord.read_channel"]).toEqual(["discord"]);
  });

  it("should have entries for notion tools", () => {
    expect(TOOL_CREDENTIAL_MAP["notion.create_page"]).toEqual(["notion"]);
    expect(TOOL_CREDENTIAL_MAP["notion.update_page"]).toEqual(["notion"]);
    expect(TOOL_CREDENTIAL_MAP["notion.query_database"]).toEqual(["notion"]);
  });

  it("should have entries for AI provider tools", () => {
    expect(TOOL_CREDENTIAL_MAP["anthropic.complete"]).toEqual(["anthropic"]);
    expect(TOOL_CREDENTIAL_MAP["openai.complete"]).toEqual(["openai"]);
    expect(TOOL_CREDENTIAL_MAP["google.complete"]).toEqual(["google"]);
    expect(TOOL_CREDENTIAL_MAP["groq.complete"]).toEqual(["groq"]);
  });

  it("should have entries for AWS tools", () => {
    expect(TOOL_CREDENTIAL_MAP["aws.s3_upload"]).toEqual(["aws"]);
    expect(TOOL_CREDENTIAL_MAP["aws.s3_download"]).toEqual(["aws"]);
    expect(TOOL_CREDENTIAL_MAP["aws.lambda_invoke"]).toEqual(["aws"]);
  });

  it("should have entries for stripe tools", () => {
    expect(TOOL_CREDENTIAL_MAP["stripe.create_charge"]).toEqual(["stripe"]);
    expect(TOOL_CREDENTIAL_MAP["stripe.list_customers"]).toEqual(["stripe"]);
  });

  it("should have entries for linear tools", () => {
    expect(TOOL_CREDENTIAL_MAP["linear.create_issue"]).toEqual(["linear"]);
    expect(TOOL_CREDENTIAL_MAP["linear.update_issue"]).toEqual(["linear"]);
  });

  it("should have an entry for telegram", () => {
    expect(TOOL_CREDENTIAL_MAP["telegram.send_message"]).toEqual(["telegram"]);
  });

  it("should map every value to a valid AccountProvider array", () => {
    for (const [key, providers] of Object.entries(TOOL_CREDENTIAL_MAP)) {
      expect(Array.isArray(providers), `${key} should map to an array`).toBe(true);
      expect(providers.length, `${key} should have at least one provider`).toBeGreaterThan(0);
      for (const p of providers) {
        expect(typeof p, `${key} provider should be a string`).toBe("string");
      }
    }
  });

  it("should return undefined for unknown tool names", () => {
    expect(TOOL_CREDENTIAL_MAP["nonexistent.tool"]).toBeUndefined();
    expect(TOOL_CREDENTIAL_MAP[""]).toBeUndefined();
    expect(TOOL_CREDENTIAL_MAP["random"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveToolProviders()
// ---------------------------------------------------------------------------

describe("resolveToolProviders", () => {
  it("should return an empty array for an empty input", () => {
    expect(resolveToolProviders([])).toEqual([]);
  });

  it("should resolve a single known tool to its provider", () => {
    const result = resolveToolProviders(["github.create_pr"]);
    expect(result).toEqual(["github"]);
  });

  it("should resolve multiple tools from the same provider without duplicates", () => {
    const result = resolveToolProviders(["github.create_pr", "github.merge_pr", "github.push"]);
    expect(result).toEqual(["github"]);
  });

  it("should resolve multiple tools from different providers", () => {
    const result = resolveToolProviders([
      "github.create_pr",
      "slack.send_message",
      "notion.create_page",
    ]);
    expect(result).toHaveLength(3);
    expect(result).toContain("github");
    expect(result).toContain("slack");
    expect(result).toContain("notion");
  });

  it("should ignore unknown tools and return only matched providers", () => {
    const result = resolveToolProviders([
      "github.create_pr",
      "unknown.tool",
      "definitely.not.real",
    ]);
    expect(result).toEqual(["github"]);
  });

  it("should return an empty array when all tools are unknown", () => {
    const result = resolveToolProviders(["unknown.tool", "another.unknown", "nope"]);
    expect(result).toEqual([]);
  });

  it("should deduplicate providers across multiple tool categories", () => {
    const result = resolveToolProviders([
      "aws.s3_upload",
      "aws.s3_download",
      "aws.lambda_invoke",
      "stripe.create_charge",
    ]);
    expect(result).toHaveLength(2);
    expect(result).toContain("aws");
    expect(result).toContain("stripe");
  });

  it("should resolve all AI provider tools correctly", () => {
    const result = resolveToolProviders([
      "anthropic.complete",
      "openai.complete",
      "google.complete",
      "groq.complete",
    ]);
    expect(result).toHaveLength(4);
    expect(result).toContain("anthropic");
    expect(result).toContain("openai");
    expect(result).toContain("google");
    expect(result).toContain("groq");
  });

  it("should handle a mix of known and unknown tools from multiple providers", () => {
    const result = resolveToolProviders([
      "telegram.send_message",
      "linear.create_issue",
      "fakeprovider.do_something",
      "discord.send_message",
    ]);
    expect(result).toHaveLength(3);
    expect(result).toContain("telegram");
    expect(result).toContain("linear");
    expect(result).toContain("discord");
  });

  it("should preserve insertion order based on first occurrence", () => {
    const result = resolveToolProviders([
      "slack.send_message",
      "github.create_pr",
      "slack.read_channel",
    ]);
    // slack encountered first, then github; second slack is deduplicated
    expect(result).toEqual(["slack", "github"]);
  });
});

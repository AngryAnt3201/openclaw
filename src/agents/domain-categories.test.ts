import { describe, expect, it } from "vitest";
import { classifyDomain, isDomainBlocked, registerCustomDomains } from "./domain-categories.js";

describe("classifyDomain", () => {
  it("classifies known financial domains", () => {
    expect(classifyDomain("https://chase.com/accounts")).toContain("financial");
    expect(classifyDomain("https://www.paypal.com/send")).toContain("financial");
    expect(classifyDomain("https://coinbase.com/trade")).toContain("financial");
  });

  it("classifies known social domains", () => {
    expect(classifyDomain("https://twitter.com/home")).toContain("social");
    expect(classifyDomain("https://www.reddit.com/r/programming")).toContain("social");
    expect(classifyDomain("https://linkedin.com/in/someone")).toContain("social");
  });

  it("classifies known email domains", () => {
    expect(classifyDomain("https://mail.google.com/mail/u/0")).toContain("email");
    expect(classifyDomain("https://outlook.live.com/mail")).toContain("email");
    expect(classifyDomain("https://protonmail.com/inbox")).toContain("email");
  });

  it("classifies known shopping domains", () => {
    expect(classifyDomain("https://amazon.com/dp/B0123")).toContain("shopping");
    expect(classifyDomain("https://www.ebay.com/itm/123")).toContain("shopping");
  });

  it("classifies known admin domains", () => {
    expect(classifyDomain("https://console.aws.amazon.com/s3")).toContain("admin");
    expect(classifyDomain("https://portal.azure.com")).toContain("admin");
    expect(classifyDomain("https://vercel.com/dashboard")).toContain("admin");
  });

  it("returns empty for unknown domains", () => {
    expect(classifyDomain("https://example.com")).toEqual([]);
    expect(classifyDomain("https://my-internal-app.com")).toEqual([]);
  });

  it("handles subdomains correctly", () => {
    // www.chase.com should match chase.com
    expect(classifyDomain("https://www.chase.com")).toContain("financial");
    // subdomain.amazon.com should match amazon.com
    expect(classifyDomain("https://smile.amazon.com")).toContain("shopping");
  });

  it("handles invalid URLs gracefully", () => {
    expect(classifyDomain("not-a-url")).toEqual([]);
    expect(classifyDomain("")).toEqual([]);
  });

  it("classifies console.aws.amazon.com as both admin and shopping", () => {
    // console.aws.amazon.com → matches "admin" (exact) and "amazon.com" (shopping)
    const categories = classifyDomain("https://console.aws.amazon.com/s3");
    expect(categories).toContain("admin");
    expect(categories).toContain("shopping");
  });
});

describe("isDomainBlocked", () => {
  it("returns true when URL matches a blocked category", () => {
    expect(isDomainBlocked("https://chase.com", ["financial"])).toBe(true);
  });

  it("returns false when URL does not match any blocked category", () => {
    expect(isDomainBlocked("https://example.com", ["financial"])).toBe(false);
  });

  it("returns false when no categories are blocked", () => {
    expect(isDomainBlocked("https://chase.com", [])).toBe(false);
  });

  it("checks multiple blocked categories", () => {
    expect(isDomainBlocked("https://amazon.com", ["financial", "shopping"])).toBe(true);
    expect(isDomainBlocked("https://chase.com", ["social", "shopping"])).toBe(false);
  });
});

describe("registerCustomDomains", () => {
  it("adds custom domains to a category", () => {
    registerCustomDomains("financial", ["mybank.example.com"]);
    expect(classifyDomain("https://mybank.example.com/login")).toContain("financial");
  });

  it("adds to existing domain categories", () => {
    registerCustomDomains("admin", ["github.com"]);
    const categories = classifyDomain("https://github.com/settings");
    expect(categories).toContain("admin");
  });
});

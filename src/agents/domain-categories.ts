// ---------------------------------------------------------------------------
// Domain Categories – Static database mapping domains to risk categories
// ---------------------------------------------------------------------------

import type { DomainCategory } from "./task-policy.js";

const CATEGORY_DOMAINS: Record<DomainCategory, readonly string[]> = {
  financial: [
    "chase.com",
    "bankofamerica.com",
    "wellsfargo.com",
    "citi.com",
    "usbank.com",
    "capitalone.com",
    "ally.com",
    "schwab.com",
    "fidelity.com",
    "vanguard.com",
    "tdameritrade.com",
    "etrade.com",
    "robinhood.com",
    "coinbase.com",
    "binance.com",
    "kraken.com",
    "paypal.com",
    "venmo.com",
    "stripe.com",
    "square.com",
    "wise.com",
    "revolut.com",
    "monzo.com",
    "starling.com",
    "hsbc.com",
    "barclays.com",
    "lloydsbank.com",
    "natwest.com",
    "halifax.co.uk",
    "santander.co.uk",
    "commbank.com.au",
    "anz.com.au",
    "westpac.com.au",
    "nab.com.au",
    "mint.intuit.com",
    "plaid.com",
  ],
  social: [
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "linkedin.com",
    "reddit.com",
    "tiktok.com",
    "snapchat.com",
    "pinterest.com",
    "tumblr.com",
    "mastodon.social",
    "threads.net",
    "bsky.app",
    "discord.com",
  ],
  email: [
    "mail.google.com",
    "outlook.live.com",
    "outlook.office.com",
    "outlook.office365.com",
    "mail.yahoo.com",
    "protonmail.com",
    "proton.me",
    "mail.zoho.com",
    "fastmail.com",
    "tutanota.com",
    "icloud.com",
    "hey.com",
    "aol.com",
  ],
  shopping: [
    "amazon.com",
    "amazon.co.uk",
    "amazon.de",
    "amazon.co.jp",
    "ebay.com",
    "walmart.com",
    "target.com",
    "bestbuy.com",
    "etsy.com",
    "shopify.com",
    "aliexpress.com",
    "wish.com",
    "newegg.com",
    "costco.com",
    "homedepot.com",
    "lowes.com",
    "wayfair.com",
    "asos.com",
    "zara.com",
    "nike.com",
    "adidas.com",
  ],
  admin: [
    "console.aws.amazon.com",
    "portal.azure.com",
    "console.cloud.google.com",
    "cloud.digitalocean.com",
    "vercel.com",
    "netlify.com",
    "heroku.com",
    "fly.io",
    "railway.app",
    "render.com",
    "cloudflare.com",
    "namecheap.com",
    "godaddy.com",
    "porkbun.com",
    "dashboard.stripe.com",
    "admin.shopify.com",
    "app.supabase.com",
    "app.planetscale.com",
    "cloud.mongodb.com",
  ],
};

// Build a lookup map: domain → Set<DomainCategory>
const domainLookup = new Map<string, Set<DomainCategory>>();
for (const [category, domains] of Object.entries(CATEGORY_DOMAINS) as [
  DomainCategory,
  readonly string[],
][]) {
  for (const domain of domains) {
    const existing = domainLookup.get(domain);
    if (existing) {
      existing.add(category);
    } else {
      domainLookup.set(domain, new Set([category]));
    }
  }
}

/**
 * Extract the registrable domain from a URL string.
 * e.g. "https://console.aws.amazon.com/s3" → "console.aws.amazon.com"
 */
function extractHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classify a URL into zero or more domain categories.
 * Checks the full hostname first, then progressively strips subdomains.
 */
export function classifyDomain(url: string): DomainCategory[] {
  const hostname = extractHostname(url);
  if (!hostname) {
    return [];
  }

  const categories = new Set<DomainCategory>();

  // Check exact hostname first, then strip subdomains
  const parts = hostname.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    const matched = domainLookup.get(candidate);
    if (matched) {
      for (const cat of matched) {
        categories.add(cat);
      }
    }
  }

  return Array.from(categories);
}

/**
 * Check if a URL belongs to any of the specified blocked categories.
 */
export function isDomainBlocked(url: string, blockedCategories: DomainCategory[]): boolean {
  if (blockedCategories.length === 0) {
    return false;
  }
  const categories = classifyDomain(url);
  const blocked = new Set(blockedCategories);
  return categories.some((c) => blocked.has(c));
}

/**
 * Add custom domains to a category (user-configurable).
 */
export function registerCustomDomains(category: DomainCategory, domains: string[]): void {
  for (const domain of domains) {
    const lower = domain.toLowerCase();
    const existing = domainLookup.get(lower);
    if (existing) {
      existing.add(category);
    } else {
      domainLookup.set(lower, new Set([category]));
    }
  }
}

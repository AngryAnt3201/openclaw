// ---------------------------------------------------------------------------
// People – Core Types
// ---------------------------------------------------------------------------

import type { InboundSourceType } from "../inbound/types.js";

// ---------------------------------------------------------------------------
// Account linking
// ---------------------------------------------------------------------------

export type AccountLinkConfidence = "auto" | "suggested" | "manual";

export type AccountLink = {
  id: string;
  platform: InboundSourceType;
  platformUserId: string;
  platformUsername: string;
  platformAvatar?: string;
  confidence: AccountLinkConfidence;
  linkedAtMs: number;
};

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------

export type SentimentValue = "positive" | "neutral" | "negative";
export type SentimentTrend = "improving" | "stable" | "declining";

export type SentimentSnapshot = {
  current: SentimentValue;
  trend: SentimentTrend;
  lastAnalyzedMs: number;
};

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------

export type Person = {
  id: string;
  displayName: string;
  avatar?: string;
  accounts: AccountLink[];
  organizationId?: string;
  groupIds: string[];
  tags: string[];
  aiTopics: string[];
  sentiment?: SentimentSnapshot;
  slaProfileId?: string;
  vaultNotePath?: string;
  notes: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export type PersonPatch = Partial<
  Pick<
    Person,
    "displayName" | "avatar" | "organizationId" | "groupIds" | "tags" | "notes" | "slaProfileId"
  >
>;

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export type Organization = {
  id: string;
  name: string;
  domain?: string;
  avatar?: string;
  tags: string[];
  vaultNotePath?: string;
  members: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type OrgPatch = Partial<Pick<Organization, "name" | "domain" | "avatar" | "tags">>;

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export type Group = {
  id: string;
  name: string;
  color?: string;
  memberIds: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type GroupPatch = Partial<Pick<Group, "name" | "color" | "memberIds">>;

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

export type IdentitySuggestion = {
  id: string;
  personId: string;
  accountLink: AccountLink;
  reason: string;
  confidence: number;
  createdAtMs: number;
  status: "pending" | "accepted" | "dismissed";
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type PeopleStoreFile = {
  version: 1;
  persons: Person[];
  organizations: Organization[];
  groups: Group[];
  suggestions: IdentitySuggestion[];
};

// ---------------------------------------------------------------------------
// Query / Filter
// ---------------------------------------------------------------------------

export type PersonFilter = {
  organizationId?: string;
  groupId?: string;
  tags?: string[];
  platform?: InboundSourceType;
  searchText?: string;
};

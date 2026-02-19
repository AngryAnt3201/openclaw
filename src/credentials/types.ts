// ---------------------------------------------------------------------------
// Credential Manager – Core Types
// ---------------------------------------------------------------------------
// Const arrays are the single source of truth. Types are derived from them
// so runtime validation and compile-time types stay in sync automatically.
// ---------------------------------------------------------------------------

export const CREDENTIAL_CATEGORIES = [
  "ai_provider",
  "channel_bot",
  "service",
  "browser_profile",
  "cli_tool",
  "custom",
] as const;

export type CredentialCategory = (typeof CREDENTIAL_CATEGORIES)[number];

export const SECRET_KINDS = ["api_key", "token", "oauth", "ssh_key"] as const;

export type SecretKind = (typeof SECRET_KINDS)[number];

/** Runtime set lookups for O(1) validation. */
export const VALID_CATEGORIES = new Set<string>(CREDENTIAL_CATEGORIES);
export const VALID_SECRET_KINDS = new Set<string>(SECRET_KINDS);

// ---------------------------------------------------------------------------
// Account providers
// ---------------------------------------------------------------------------

export const ACCOUNT_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "github",
  "notion",
  "slack",
  "discord",
  "telegram",
  "whatsapp",
  "stripe",
  "aws",
  "vercel",
  "groq",
  "mistral",
  "xai",
  "deepseek",
  "cerebras",
  "fireworks",
  "perplexity",
  "cohere",
  "linear",
  "custom",
] as const;

export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];

export const VALID_ACCOUNT_PROVIDERS = new Set<string>(ACCOUNT_PROVIDERS);

// ---------------------------------------------------------------------------
// Secret variants (runtime only — never stored in plaintext)
// ---------------------------------------------------------------------------

export type ApiKeySecret = {
  kind: "api_key";
  key: string;
  email?: string;
  metadata?: Record<string, string>;
};

export type TokenSecret = {
  kind: "token";
  token: string;
  expiresAtMs?: number;
  refreshToken?: string;
  email?: string;
};

export type OAuthSecret = {
  kind: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
  clientId?: string;
  email?: string;
  scopes?: string[];
};

export type SshKeySecret = {
  kind: "ssh_key";
  privateKey: string;
  publicKey?: string;
  passphrase?: string;
  fingerprint?: string;
};

export type CredentialSecret = ApiKeySecret | TokenSecret | OAuthSecret | SshKeySecret;

// ---------------------------------------------------------------------------
// Access grants & leases
// ---------------------------------------------------------------------------

export type AccessGrant = {
  agentId: string;
  grantedAtMs: number;
  grantedBy: string;
};

export type CredentialLease = {
  leaseId: string;
  taskId: string;
  agentId: string;
  credentialId: string;
  grantedAtMs: number;
  expiresAtMs: number;
  revokedAtMs?: number;
  maxUses?: number;
  usesRemaining?: number;
};

// ---------------------------------------------------------------------------
// Permission rules
// ---------------------------------------------------------------------------

export type ConstraintType =
  | "tool_allowlist"
  | "tool_denylist"
  | "action_restriction"
  | "rate_limit"
  | "time_window"
  | "purpose_restriction";

export type CompiledConstraint = {
  type: ConstraintType;
  tools?: string[];
  actions?: string[];
  maxPerMinute?: number;
  maxPerHour?: number;
  allowedHoursUtc?: { start: number; end: number };
  purposes?: string[];
};

export type PermissionRule = {
  id: string;
  text: string;
  compiledConstraints: CompiledConstraint[];
  createdAtMs: number;
  enabled: boolean;
};

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

export type UsageOutcome = "success" | "failure" | "blocked";

export type UsageRecord = {
  timestamp: number;
  agentId: string;
  taskId?: string;
  toolName?: string;
  action: string;
  outcome: UsageOutcome;
};

// ---------------------------------------------------------------------------
// Accounts — group credentials by service identity
// ---------------------------------------------------------------------------

export type Account = {
  id: string;
  name: string;
  provider: AccountProvider;
  icon?: string;
  email?: string;
  credentialIds: string[];
  tags: string[];
  metadata: Record<string, string>;
  createdAtMs: number;
  updatedAtMs: number;
};

export type AccountCreateInput = {
  name: string;
  provider: AccountProvider;
  icon?: string;
  email?: string;
  tags?: string[];
  metadata?: Record<string, string>;
};

export type AccountPatch = {
  name?: string;
  icon?: string;
  email?: string;
  tags?: string[];
  metadata?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Agent credential profiles — map agents to accounts
// ---------------------------------------------------------------------------

export type AgentAccountBinding = {
  accountId: string;
  grantedAtMs: number;
  grantedBy: string;
  restrictions?: {
    credentialIds?: string[];
    readOnly?: boolean;
    maxLeaseTtlMs?: number;
  };
};

export type AgentCredentialProfile = {
  agentId: string;
  accountBindings: AgentAccountBinding[];
  directGrants: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

// ---------------------------------------------------------------------------
// Core Credential record
// ---------------------------------------------------------------------------

export type Credential = {
  id: string;
  name: string;
  category: CredentialCategory;
  provider: string;
  description?: string;
  tags?: string[];
  secretRef: string;
  /** @deprecated Use agent profiles instead. Preserved for backwards compatibility. */
  accessGrants: AccessGrant[];
  activeLeases: CredentialLease[];
  permissionRules: PermissionRule[];
  lastUsedAtMs?: number;
  lastUsedByAgent?: string;
  usageCount: number;
  usageHistory: UsageRecord[];
  createdAtMs: number;
  updatedAtMs: number;
  enabled: boolean;
  migratedFrom?: string;
  accountId?: string;
  detectedProvider?: string;
  secretKind?: SecretKind;
  validatedAtMs?: number;
  expiresAtMs?: number;
};

// ---------------------------------------------------------------------------
// Credential creation / patch
// ---------------------------------------------------------------------------

export type CredentialCreateInput = {
  name: string;
  category: CredentialCategory;
  provider: string;
  description?: string;
  tags?: string[];
  secret: CredentialSecret;
  accountId?: string;
};

export type CredentialPatch = {
  name?: string;
  category?: CredentialCategory;
  provider?: string;
  description?: string;
  tags?: string[];
  enabled?: boolean;
  accountId?: string;
};

// ---------------------------------------------------------------------------
// Checkout result (returned on successful secret retrieval)
// ---------------------------------------------------------------------------

export type CredentialCheckout = {
  credentialId: string;
  secret: CredentialSecret;
  expiresAtMs?: number;
};

// ---------------------------------------------------------------------------
// Encrypted store file shape
// ---------------------------------------------------------------------------

export type EncryptedEnvelope = {
  algorithm: "aes-256-gcm";
  kdfParams: {
    salt: string;
    N: number;
    r: number;
    p: number;
    dkLen: number;
  };
  nonce: string;
  ciphertext: string;
  tag: string;
};

/** v2 store shape (legacy) */
export type CredentialStoreFileV2 = {
  version: 2;
  credentials: Credential[];
  secrets: Record<string, EncryptedEnvelope>;
  masterKeyCheck: string;
};

/** v3 store shape (current) — adds accounts and agent profiles */
export type CredentialStoreFile = {
  version: 3;
  credentials: Credential[];
  secrets: Record<string, EncryptedEnvelope>;
  masterKeyCheck: string;
  accounts: Account[];
  agentProfiles: AgentCredentialProfile[];
};

// ---------------------------------------------------------------------------
// Credential filter (for list queries)
// ---------------------------------------------------------------------------

export type CredentialFilter = {
  category?: CredentialCategory;
  provider?: string;
  enabled?: boolean;
  agentId?: string;
  accountId?: string;
  limit?: number;
};

// ---------------------------------------------------------------------------
// Account filter
// ---------------------------------------------------------------------------

export type AccountFilter = {
  provider?: AccountProvider;
  limit?: number;
};

// ---------------------------------------------------------------------------
// Audit log entry
// ---------------------------------------------------------------------------

export type CredentialAuditEntry = {
  timestamp: number;
  action: string;
  credentialId: string;
  credentialName?: string;
  agentId?: string;
  taskId?: string;
  outcome: UsageOutcome | "info";
  detail?: string;
};

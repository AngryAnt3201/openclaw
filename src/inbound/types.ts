// ---------------------------------------------------------------------------
// Inbound Types – Backend authoritative types
// ---------------------------------------------------------------------------

export type InboundSourceType =
  | "discord"
  | "telegram"
  | "slack"
  | "whatsapp"
  | "email"
  | "webhook"
  | "api"
  | "sms"
  | "instagram"
  | "custom";

export type InboundMessageStatus = "unread" | "read" | "flagged" | "snoozed" | "archived";

export type InboundPriority = "critical" | "high" | "medium" | "low";

export const PRIORITY_ORDER: Record<InboundPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface InboundSource {
  type: InboundSourceType;
  channelId: string;
  channelName?: string;
  senderId?: string;
  senderName?: string;
  senderAvatar?: string;
  platformMeta?: Record<string, unknown>;
}

export interface InboundAttachment {
  id: string;
  filename: string;
  mimeType: string;
  url?: string;
  sizeBytes?: number;
}

export interface InboundMention {
  id: string;
  name: string;
  avatar?: string;
  type: "user" | "channel" | "group";
}

export interface InboundProcessingResult {
  taskId?: string;
  agentId?: string;
  summary?: string;
  error?: string;
}

// ---- Snooze configuration ----

export type SnoozeConfigType = "time" | "reply" | "task" | "pipeline";

export interface SnoozeConfig {
  type: SnoozeConfigType;
  untilMs?: number;
  untilReplyFromPersonId?: string;
  untilTaskId?: string;
  untilPipelineRunId?: string;
  followUpDraftOnExpiry?: boolean;
  snoozedAtMs: number;
}

export interface InboundPendingAction {
  routeId: string;
  routeName: string;
  action: InboundRouteAction;
}

export interface InboundMessage {
  id: string;
  source: InboundSource;
  status: InboundMessageStatus;
  direction: "inbound" | "outbound";
  body: string;
  bodyResolved: string;
  mentions: InboundMention[];
  subject?: string;
  attachments?: InboundAttachment[];
  taskId?: string;
  threadId?: string;
  replyToId?: string;
  personId?: string;
  /** @deprecated Use snoozeConfig instead. Kept for backward compatibility. */
  snoozedUntilMs?: number;
  snoozeConfig?: SnoozeConfig;
  readAtMs?: number;
  flaggedAtMs?: number;
  archivedAtMs?: number;
  metadata?: Record<string, unknown>;
  externalId?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface InboundChannel {
  id: string;
  type: InboundSourceType;
  name: string;
  enabled: boolean;
  status?: "connected" | "connecting" | "syncing" | "disconnected" | "error";
  lastSyncMs?: number;
  errorMessage?: string;
  config?: Record<string, unknown>;
  defaultPriority?: InboundPriority;
  messageCount?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface InboundFilter {
  sourceTypes?: InboundSourceType[];
  channelIds?: string[];
  senderIds?: string[];
  keywords?: string[];
  intents?: string[];
  minPriority?: InboundPriority;
}

export interface InboundRouteAction {
  createTask?: {
    agentId?: string;
    priority?: InboundPriority;
    type?: string;
  };
  forwardToAgent?: string;
  runPipeline?: string;
  autoReply?: string;
  ignore?: boolean;
}

export interface InboundRoute {
  id: string;
  name: string;
  enabled: boolean;
  filter: InboundFilter;
  action: InboundRouteAction;
  autoExecute: boolean;
  order: number;
  createdAtMs: number;
  updatedAtMs: number;
}

// ---- Store schema ----

export interface InboundStoreFile {
  version: 1 | 2 | 3;
  messages: InboundMessage[];
  channels: InboundChannel[];
  routes: InboundRoute[];
}

// ---- Query / filter helpers ----

/**
 * @deprecated Use InboundMessageQuery instead for listing/querying messages.
 * Kept for backward compatibility with existing code that references it.
 */
export interface InboundMessageFilter {
  status?: InboundMessageStatus | InboundMessageStatus[];
  sourceType?: InboundSourceType | InboundSourceType[];
  channelId?: string;
  priority?: InboundPriority | InboundPriority[];
  taskId?: string;
  since?: number;
  limit?: number;
}

export interface InboundMessageQuery {
  sourceTypes?: InboundSourceType[];
  channelIds?: string[];
  senderName?: string;
  status?: InboundMessageStatus[];
  hasAttachment?: boolean;
  hasTask?: boolean;
  hasThread?: boolean;
  mentionsUser?: string;
  beforeMs?: number;
  afterMs?: number;
  searchText?: string;
}

export interface InboundMessagePage {
  messages: InboundMessage[];
  nextCursor: string | null;
  totalCount: number;
}

export interface InboundCounts {
  unread: number;
  read: number;
  flagged: number;
  snoozed: number;
  archived: number;
  bySource: Record<string, number>;
  byChannel: Record<string, number>;
}

// ---- Input types ----

export interface RawInboundMessage {
  source: InboundSource;
  body: string;
  bodyResolved?: string;
  subject?: string;
  mentions?: InboundMention[];
  attachments?: InboundAttachment[];
  metadata?: Record<string, unknown>;
  externalId?: string;
}

export interface InboundChannelCreateInput {
  type: InboundSourceType;
  name: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  defaultPriority?: InboundPriority;
}

export interface InboundChannelPatch {
  name?: string;
  enabled?: boolean;
  status?: InboundChannel["status"];
  lastSyncMs?: number;
  errorMessage?: string;
  config?: Record<string, unknown>;
  defaultPriority?: InboundPriority;
}

export interface InboundRouteCreateInput {
  name: string;
  enabled?: boolean;
  filter: InboundFilter;
  action: InboundRouteAction;
  autoExecute?: boolean;
  order?: number;
}

export interface InboundRoutePatch {
  name?: string;
  enabled?: boolean;
  filter?: InboundFilter;
  action?: InboundRouteAction;
  autoExecute?: boolean;
  order?: number;
}

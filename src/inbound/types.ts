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
  | "custom";

export type InboundMessageStatus =
  | "pending"
  | "queued"
  | "processing"
  | "processed"
  | "failed"
  | "ignored";

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

export interface InboundProcessingResult {
  taskId?: string;
  agentId?: string;
  summary?: string;
  error?: string;
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
  priority: InboundPriority;
  body: string;
  subject?: string;
  intent?: string;
  attachments?: InboundAttachment[];
  taskId?: string;
  result?: InboundProcessingResult;
  pendingAction?: InboundPendingAction;
  metadata?: Record<string, unknown>;
  externalId?: string;
  createdAtMs: number;
  updatedAtMs: number;
  processedAtMs?: number;
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
  version: 1;
  messages: InboundMessage[];
  channels: InboundChannel[];
  routes: InboundRoute[];
}

// ---- Query / filter helpers ----

export interface InboundMessageFilter {
  status?: InboundMessageStatus | InboundMessageStatus[];
  sourceType?: InboundSourceType | InboundSourceType[];
  channelId?: string;
  priority?: InboundPriority | InboundPriority[];
  taskId?: string;
  since?: number;
  limit?: number;
}

// ---- Input types ----

export interface RawInboundMessage {
  source: InboundSource;
  body: string;
  subject?: string;
  intent?: string;
  priority?: InboundPriority;
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

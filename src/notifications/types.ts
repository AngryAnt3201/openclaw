// ---------------------------------------------------------------------------
// Notification System – Core Types
// ---------------------------------------------------------------------------

export type NotificationStatus = "unread" | "read" | "dismissed";

export type NotificationPriority = "critical" | "high" | "medium" | "low";

export type NotificationType =
  | "task_state_change"
  | "agent_alert"
  | "system_event"
  | "scheduled_reminder"
  | "message_received"
  | "approval_request"
  | "custom";

// ---------------------------------------------------------------------------
// Channel delivery tracking
// ---------------------------------------------------------------------------

export type NotificationChannelStatus = "pending" | "sent" | "failed";

export type NotificationChannelDelivery = {
  channel: string;
  status: NotificationChannelStatus;
  sentAtMs?: number;
  error?: string;
};

// ---------------------------------------------------------------------------
// Core Notification interface
// ---------------------------------------------------------------------------

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  priority: NotificationPriority;
  status: NotificationStatus;

  // Optional associations
  taskId?: string;
  agentId?: string;
  source?: string;

  // Channel delivery tracking
  channels: NotificationChannelDelivery[];

  // Timestamps
  createdAtMs: number;
  updatedAtMs: number;
  readAtMs?: number;
  dismissedAtMs?: number;

  // Extensible metadata
  data?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Creation input
// ---------------------------------------------------------------------------

export type NotificationCreateInput = {
  type: NotificationType;
  title: string;
  body: string;
  priority?: NotificationPriority;
  taskId?: string;
  agentId?: string;
  source?: string;
  channels?: string[];
  data?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

export type NotificationFilter = {
  status?: NotificationStatus | NotificationStatus[];
  type?: NotificationType | NotificationType[];
  priority?: NotificationPriority | NotificationPriority[];
  taskId?: string;
  limit?: number;
  since?: number;
};

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export type ChannelRouteConfig = {
  enabled: boolean;
  channels: string[];
  minPriority?: NotificationPriority;
};

export type QuietHours = {
  enabled: boolean;
  startHour: number; // 0-23
  endHour: number; // 0-23
  timezone?: string;
};

export type WebhookConfig = {
  url: string;
  secret?: string;
  enabled: boolean;
};

export type NotificationPreferences = {
  enabled: boolean;
  defaultChannels: string[];
  routes: Partial<Record<NotificationType, ChannelRouteConfig>>;
  quietHours: QuietHours;
  webhooks: WebhookConfig[];
};

// ---------------------------------------------------------------------------
// Channel target configuration (stored in config)
// ---------------------------------------------------------------------------

export type NotificationChannelTargets = {
  discord?: string;
  telegram?: string;
  whatsapp?: string;
  slack?: string;
  signal?: string;
  [key: string]: string | undefined;
};

// ---------------------------------------------------------------------------
// Store file shape
// ---------------------------------------------------------------------------

export type NotificationStoreFile = {
  version: 1;
  notifications: Notification[];
  preferences: NotificationPreferences;
};

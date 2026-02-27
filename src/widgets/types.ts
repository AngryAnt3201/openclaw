// ---------------------------------------------------------------------------
// Widget Engine – Core Types
// ---------------------------------------------------------------------------
// Const arrays are the single source of truth. Types are derived from them
// so runtime validation and compile-time types stay in sync automatically.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Widget type enum (21 built-in types)
// ---------------------------------------------------------------------------

export const WIDGET_TYPES = [
  "tasks",
  "notifications",
  "sessions",
  "credentials",
  "system-monitor",
  "network-status",
  "gateway-status",
  "agent-activity",
  "chat-log",
  "tool-usage",
  "analytics",
  "trend",
  "database-viewer",
  "calendar",
  "weather",
  "clock",
  "quick-notes",
  "file-browser",
  "image-viewer",
  "status-card",
  "custom",
  "iframe",
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

// ---------------------------------------------------------------------------
// Widget categories
// ---------------------------------------------------------------------------

export const WIDGET_CATEGORIES = [
  "system",
  "agent",
  "data",
  "productivity",
  "media",
  "custom",
] as const;

export type WidgetCategory = (typeof WIDGET_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Runtime set lookups for O(1) validation in RPC handlers
// ---------------------------------------------------------------------------

export const VALID_WIDGET_TYPES = new Set<string>(WIDGET_TYPES);
export const VALID_WIDGET_CATEGORIES = new Set<string>(WIDGET_CATEGORIES);

// ---------------------------------------------------------------------------
// Widget schema types (describes the visual layout of a widget)
// ---------------------------------------------------------------------------

export const WIDGET_SCHEMA_LAYOUTS = [
  "kv",
  "list",
  "chart",
  "markdown",
  "grid",
  "composite",
] as const;

export type WidgetSchemaLayout = (typeof WIDGET_SCHEMA_LAYOUTS)[number];

export const WIDGET_FIELD_TYPES = [
  "text",
  "number",
  "progress",
  "badge",
  "sparkline",
  "icon",
  "button",
  "input",
  "toggle",
  "select",
] as const;

export type WidgetFieldType = (typeof WIDGET_FIELD_TYPES)[number];

export type WidgetField = {
  key: string;
  label: string;
  type: WidgetFieldType;
  format?: string;
  action?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

export type WidgetSlot = {
  name: string;
  layout: WidgetSchemaLayout;
  fields: WidgetField[];
};

export type WidgetAction = {
  name: string;
  label: string;
  description?: string;
};

export type IframeWidgetConfig = {
  mode: "url" | "inline";
  url?: string;
  html?: string;
};

export type WidgetActionPayload = {
  instanceId: string;
  definitionId: string;
  actionName: string;
  payload: Record<string, unknown>;
  triggeredBy: "user" | "iframe";
};

export type WidgetSchema = {
  layout: WidgetSchemaLayout;
  fields?: WidgetField[];
  slots?: WidgetSlot[];
  actions?: WidgetAction[];
  iframe?: IframeWidgetConfig;
};

// ---------------------------------------------------------------------------
// Widget size constraints
// ---------------------------------------------------------------------------

export type WidgetSize = {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  defaultW: number;
  defaultH: number;
};

// ---------------------------------------------------------------------------
// Data source configuration (embedded in WidgetDefinition)
// ---------------------------------------------------------------------------

export const DATA_SOURCE_TYPES = ["stream", "direct", "store"] as const;

export type DataSourceType = (typeof DATA_SOURCE_TYPES)[number];

export type WidgetDataSourceConfig = {
  type: DataSourceType;
  streamId?: string;
  storeKey?: string;
};

// ---------------------------------------------------------------------------
// Widget definition (the "blueprint" for a widget)
// ---------------------------------------------------------------------------

export type WidgetDefinition = {
  id: string;
  type: WidgetType;
  name: string;
  description?: string;
  category: WidgetCategory;
  size: WidgetSize;
  schema?: WidgetSchema;
  dataSource?: WidgetDataSourceConfig;
  createdBy: string;
  createdAt: number;
  persistent: boolean;
};

// ---------------------------------------------------------------------------
// Widget instance (a placed widget on the dashboard)
// ---------------------------------------------------------------------------

export type WidgetInstance = {
  id: string;
  definitionId: string;
  position: { x: number; y: number };
  dimensions: { w: number; h: number };
  pinned: boolean;
  minimized: boolean;
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
  spawnedBy?: string;
  deviceId?: string;
  createdAt: number;
};

// ---------------------------------------------------------------------------
// Data source (standalone data feed a widget can subscribe to)
// ---------------------------------------------------------------------------

export type DataSource = {
  id: string;
  name: string;
  schema?: WidgetSchema;
  lastValue?: Record<string, unknown>;
  lastUpdated?: number;
  ttl?: number;
  createdBy: string;
};

// ---------------------------------------------------------------------------
// Creation inputs
// ---------------------------------------------------------------------------

export type WidgetDefinitionCreateInput = {
  type: WidgetType;
  name: string;
  description?: string;
  category?: WidgetCategory;
  size?: Partial<WidgetSize>;
  schema?: WidgetSchema;
  dataSource?: WidgetDataSourceConfig;
  createdBy?: string;
  persistent?: boolean;
};

export type WidgetInstanceCreateInput = {
  definitionId: string;
  position?: { x: number; y: number };
  dimensions?: { w: number; h: number };
  pinned?: boolean;
  minimized?: boolean;
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
  spawnedBy?: string;
  deviceId?: string;
};

export type DataSourceCreateInput = {
  name: string;
  schema?: WidgetSchema;
  ttl?: number;
  createdBy?: string;
};

// ---------------------------------------------------------------------------
// Patch type (partial update for widget instances)
// ---------------------------------------------------------------------------

export type WidgetInstancePatch = {
  position?: { x: number; y: number };
  dimensions?: { w: number; h: number };
  pinned?: boolean;
  minimized?: boolean;
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Store file shapes (persisted to disk)
// ---------------------------------------------------------------------------

export type WidgetRegistryFile = {
  definitions: WidgetDefinition[];
};

export type WidgetInstancesFile = {
  instances: WidgetInstance[];
};

export type DataSourcesFile = {
  sources: DataSource[];
};

// ---------------------------------------------------------------------------
// Widget event types
// ---------------------------------------------------------------------------

export const WIDGET_EVENT_TYPES = [
  "widget.definition.created",
  "widget.definition.deleted",
  "widget.instance.spawned",
  "widget.instance.dismissed",
  "widget.instance.updated",
  "widget.data.pushed",
  "widget.stream.created",
  "widget.stream.pushed",
  "widget.stream.deleted",
  "widget.action.triggered",
] as const;

export type WidgetEventType = (typeof WIDGET_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Widget filter (for list queries)
// ---------------------------------------------------------------------------

export type WidgetDefinitionFilter = {
  type?: WidgetType | WidgetType[];
  category?: WidgetCategory | WidgetCategory[];
  createdBy?: string;
  persistent?: boolean;
  limit?: number;
};

export type WidgetInstanceFilter = {
  definitionId?: string;
  deviceId?: string;
  spawnedBy?: string;
  pinned?: boolean;
  limit?: number;
};

// ---------------------------------------------------------------------------
// Default widget sizes
// ---------------------------------------------------------------------------

export const DEFAULT_WIDGET_SIZES: Record<WidgetType, WidgetSize> = {
  tasks: { minW: 240, maxW: 480, minH: 160, maxH: 400, defaultW: 320, defaultH: 280 },
  notifications: { minW: 240, maxW: 480, minH: 120, maxH: 360, defaultW: 320, defaultH: 240 },
  sessions: { minW: 240, maxW: 480, minH: 160, maxH: 400, defaultW: 320, defaultH: 280 },
  credentials: { minW: 240, maxW: 480, minH: 140, maxH: 360, defaultW: 300, defaultH: 240 },
  "system-monitor": { minW: 200, maxW: 420, minH: 120, maxH: 320, defaultW: 280, defaultH: 200 },
  "network-status": { minW: 200, maxW: 400, minH: 100, maxH: 280, defaultW: 260, defaultH: 180 },
  "gateway-status": { minW: 180, maxW: 360, minH: 80, maxH: 240, defaultW: 240, defaultH: 140 },
  "agent-activity": { minW: 240, maxW: 480, minH: 160, maxH: 400, defaultW: 320, defaultH: 280 },
  "chat-log": { minW: 260, maxW: 480, minH: 200, maxH: 400, defaultW: 340, defaultH: 320 },
  "tool-usage": { minW: 200, maxW: 420, minH: 120, maxH: 320, defaultW: 280, defaultH: 200 },
  analytics: { minW: 240, maxW: 480, minH: 160, maxH: 400, defaultW: 340, defaultH: 280 },
  trend: { minW: 200, maxW: 480, minH: 100, maxH: 320, defaultW: 300, defaultH: 200 },
  "database-viewer": { minW: 280, maxW: 480, minH: 200, maxH: 400, defaultW: 400, defaultH: 320 },
  calendar: { minW: 200, maxW: 400, minH: 180, maxH: 360, defaultW: 280, defaultH: 280 },
  weather: { minW: 160, maxW: 320, minH: 80, maxH: 240, defaultW: 220, defaultH: 160 },
  clock: { minW: 160, maxW: 280, minH: 60, maxH: 200, defaultW: 200, defaultH: 120 },
  "quick-notes": { minW: 200, maxW: 400, minH: 120, maxH: 360, defaultW: 260, defaultH: 200 },
  "file-browser": { minW: 240, maxW: 480, minH: 200, maxH: 400, defaultW: 340, defaultH: 320 },
  "image-viewer": { minW: 200, maxW: 480, minH: 160, maxH: 400, defaultW: 320, defaultH: 280 },
  "status-card": { minW: 160, maxW: 360, minH: 60, maxH: 200, defaultW: 220, defaultH: 120 },
  custom: { minW: 160, maxW: 480, minH: 60, maxH: 400, defaultW: 280, defaultH: 200 },
  iframe: { minW: 200, maxW: 480, minH: 160, maxH: 400, defaultW: 360, defaultH: 300 },
};

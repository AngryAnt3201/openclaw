// ---------------------------------------------------------------------------
// Pipeline System – Core Types
// ---------------------------------------------------------------------------
// Const arrays are the single source of truth. Types are derived from them
// so runtime validation and compile-time types stay in sync automatically.
// ---------------------------------------------------------------------------

// ===========================================================================
// NODE TYPE IDENTIFIERS
// ===========================================================================

/** Canonical enum of all built-in node types. */
export enum CoreNodeType {
  Cron = "cron",
  Webhook = "webhook",
  TaskEvent = "task_event",
  Manual = "manual",
  Agent = "agent",
  App = "app",
  Condition = "condition",
  Approval = "approval",
  Loop = "loop",
  Code = "code",
  Notify = "notify",
}

/** O(1) membership check for built-in types. */
export const CORE_NODE_TYPES = new Set<string>(Object.values(CoreNodeType));

/** Backward-compat arrays derived from the enum. */
export const TRIGGER_NODE_TYPES = [
  CoreNodeType.Cron,
  CoreNodeType.Webhook,
  CoreNodeType.TaskEvent,
  CoreNodeType.Manual,
] as const;

export type TriggerNodeType = (typeof TRIGGER_NODE_TYPES)[number];

export const PROCESSING_NODE_TYPES = [
  CoreNodeType.Agent,
  CoreNodeType.App,
  CoreNodeType.Condition,
  CoreNodeType.Approval,
  CoreNodeType.Loop,
  CoreNodeType.Code,
] as const;

export type ProcessingNodeType = (typeof PROCESSING_NODE_TYPES)[number];

export const ACTION_NODE_TYPES = [CoreNodeType.Notify] as const;

export type ActionNodeType = (typeof ACTION_NODE_TYPES)[number];

/** Union of all built-in node types, plus arbitrary string for custom nodes. */
export type NodeType = TriggerNodeType | ProcessingNodeType | ActionNodeType | (string & {});

export const NODE_CATEGORIES = ["trigger", "processing", "action"] as const;

export type NodeCategory = (typeof NODE_CATEGORIES)[number];

/** Runtime set lookups for O(1) validation. */
export const VALID_TRIGGER_NODE_TYPES = new Set<string>(TRIGGER_NODE_TYPES);
export const VALID_PROCESSING_NODE_TYPES = new Set<string>(PROCESSING_NODE_TYPES);
export const VALID_ACTION_NODE_TYPES = new Set<string>(ACTION_NODE_TYPES);

// ===========================================================================
// NODE CONFIGS — Trigger nodes
// ===========================================================================

export type CronTriggerConfig = {
  schedule: string;
  timezone?: string;
};

export type WebhookTriggerConfig = {
  path: string;
  secret?: string;
  method?: "GET" | "POST" | "PUT";
};

export type TaskEventTriggerConfig = {
  eventFilter: string;
  taskType?: string;
  taskStatus?: string;
};

export type ManualTriggerConfig = {
  label?: string;
};

// ===========================================================================
// NODE CONFIGS — Processing nodes
// ===========================================================================

export type AgentNodeConfig = {
  prompt: string;
  model?: string;
  session?: "main" | "isolated";
  timeout?: number;
  thinking?: string;
  credentials?: string[];
  tools?: string[];
  apps?: string[];
};

export type AppNodeConfig = {
  appId: string;
  prompt: string;
  session?: "main" | "isolated";
  lifecycle?: "keep-alive" | "ephemeral";
  timeout?: number;
};

export type ConditionConfig = {
  question: string;
  options: string[];
};

export type ApprovalConfig = {
  message: string;
  approverIds?: string[];
  timeout?: number;
  timeoutAction?: "deny" | "skip" | "escalate";
};

export type LoopConfig = {
  maxIterations: number;
  condition?: string;
};

export type CodeNodeConfig = {
  description: string;
  language?: string;
  maxRetries?: number;
  timeout?: number;
};

// ===========================================================================
// NODE CONFIGS — Action nodes
// ===========================================================================

export type NotifyConfig = {
  channels?: string[];
  message?: string;
  priority?: "critical" | "high" | "medium" | "low";
};

// ===========================================================================
// NODE CONFIG UNION
// ===========================================================================

export type NodeConfig =
  | CronTriggerConfig
  | WebhookTriggerConfig
  | TaskEventTriggerConfig
  | ManualTriggerConfig
  | AgentNodeConfig
  | AppNodeConfig
  | ConditionConfig
  | ApprovalConfig
  | LoopConfig
  | CodeNodeConfig
  | NotifyConfig;

// ===========================================================================
// NODE STATE
// ===========================================================================

export const NODE_STATUSES = [
  "idle",
  "running",
  "success",
  "failed",
  "skipped",
  "waiting",
] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

export type PipelineNodeState = {
  status: NodeStatus;
  startedAtMs?: number;
  completedAtMs?: number;
  error?: string;
  output?: unknown;
  retryCount: number;
};

// ===========================================================================
// PIPELINE NODE
// ===========================================================================

export type PipelineNode = {
  id: string;
  type: NodeType;
  label: string;
  config: NodeConfig;
  position: { x: number; y: number };
  state: PipelineNodeState;
};

// ===========================================================================
// PIPELINE EDGE
// ===========================================================================

export type PipelineEdge = {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  condition?: string;
};

// ===========================================================================
// PIPELINE STATUS
// ===========================================================================

export const PIPELINE_STATUSES = ["draft", "active", "paused", "error", "archived"] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

// ===========================================================================
// PIPELINE
// ===========================================================================

export type Pipeline = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
  status: PipelineStatus;
  viewport: { x: number; y: number; zoom: number };
  createdAtMs: number;
  updatedAtMs: number;
  runCount: number;
};

// ===========================================================================
// CRUD HELPERS
// ===========================================================================

export type PipelineCreate = {
  name: string;
  description?: string;
  enabled?: boolean;
  nodes?: PipelineNode[];
  edges?: PipelineEdge[];
  viewport?: { x: number; y: number; zoom: number };
};

export type PipelinePatch = {
  name?: string;
  description?: string;
  enabled?: boolean;
  status?: PipelineStatus;
  nodes?: PipelineNode[];
  edges?: PipelineEdge[];
  viewport?: { x: number; y: number; zoom: number };
  runCount?: number;
};

// ===========================================================================
// PIPELINE RUN
// ===========================================================================

export const PIPELINE_RUN_STATUSES = [
  "pending",
  "running",
  "success",
  "failed",
  "cancelled",
] as const;

export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

export type PipelineRunNodeResult = {
  nodeId: string;
  status: NodeStatus;
  startedAtMs?: number;
  completedAtMs?: number;
  output?: unknown;
  error?: string;
};

export type PipelineRun = {
  id: string;
  pipelineId: string;
  status: PipelineRunStatus;
  trigger: string;
  triggerData?: Record<string, unknown>;
  nodeResults: PipelineRunNodeResult[];
  startedAtMs: number;
  completedAtMs?: number;
  error?: string;
};

// ===========================================================================
// STORE FILE
// ===========================================================================

export type PipelineStoreFile = {
  version: 1;
  pipelines: Pipeline[];
};

// ===========================================================================
// NODE REGISTRY TYPES
// ===========================================================================

export type NodeConfigField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select" | "json" | "code";
  required?: boolean;
  defaultValue?: unknown;
  options?: string[];
  placeholder?: string;
};

export type PortDefinition = {
  id: string;
  label: string;
  type: "input" | "output";
};

export type NodeExecutor = (
  node: PipelineNode,
  inputs: Record<string, unknown>,
  context: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export type NodeDefinition = {
  type: NodeType;
  category: NodeCategory;
  label: string;
  description: string;
  icon?: string;
  configFields: NodeConfigField[];
  ports: PortDefinition[];
  executor?: NodeExecutor;
};

// ===========================================================================
// EVENTS
// ===========================================================================

export type PipelineEventType =
  | "pipeline_created"
  | "pipeline_updated"
  | "pipeline_deleted"
  | "pipeline_enabled"
  | "pipeline_disabled"
  | "run_started"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "node_started"
  | "node_completed"
  | "node_failed"
  | "node_skipped";

export type PipelineEvent = {
  id: string;
  pipelineId: string;
  runId?: string;
  nodeId?: string;
  type: PipelineEventType;
  timestamp: number;
  message: string;
  data?: Record<string, unknown>;
};

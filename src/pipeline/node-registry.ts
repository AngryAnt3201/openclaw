// ---------------------------------------------------------------------------
// Pipeline System – Node Registry
// ---------------------------------------------------------------------------
// Extensible registry of node type definitions used by both the pipeline
// engine and the canvas UI to know what nodes are available.
// ---------------------------------------------------------------------------

import type { NodeDefinition, NodeCategory } from "./types.js";

// ===========================================================================
// NODE REGISTRY
// ===========================================================================

export class NodeRegistry {
  private readonly defs = new Map<string, NodeDefinition>();

  /** Add or overwrite a node definition. */
  register(def: NodeDefinition): void {
    this.defs.set(def.type, def);
  }

  /** Get a definition by its type string. */
  get(type: string): NodeDefinition | undefined {
    return this.defs.get(type);
  }

  /** List all registered definitions. */
  list(): NodeDefinition[] {
    return [...this.defs.values()];
  }

  /** Filter registered definitions by category. */
  listByCategory(category: NodeCategory): NodeDefinition[] {
    return [...this.defs.values()].filter((d) => d.category === category);
  }

  /** Register all 12 built-in node types. */
  registerBuiltins(): void {
    for (const def of BUILTIN_NODE_DEFINITIONS) {
      this.register(def);
    }
  }
}

// ===========================================================================
// BUILT-IN DEFINITIONS
// ===========================================================================

/**
 * The 12 built-in node definitions, grouped by category.
 *
 * Trigger nodes (4): cron, webhook, task_event, manual
 * Processing nodes (6): agent, app, condition, approval, loop, code
 * Action nodes (2): notify, output
 */
export const BUILTIN_NODE_DEFINITIONS: readonly NodeDefinition[] = [
  // -------------------------------------------------------------------------
  // TRIGGERS
  // -------------------------------------------------------------------------
  {
    type: "cron",
    category: "trigger",
    label: "Cron Schedule",
    description: "Trigger a pipeline on a recurring cron schedule.",
    icon: "clock",
    configFields: [
      {
        key: "schedule",
        label: "Schedule",
        type: "string",
        required: true,
        placeholder: "*/5 * * * *",
      },
    ],
    ports: [{ id: "trigger", label: "Trigger", type: "output" }],
  },
  {
    type: "webhook",
    category: "trigger",
    label: "Webhook",
    description: "Trigger a pipeline from an incoming HTTP webhook.",
    icon: "webhook",
    configFields: [
      { key: "path", label: "Path", type: "string", required: true, placeholder: "/hooks/my-hook" },
      { key: "secret", label: "Auth Token", type: "string" },
    ],
    ports: [{ id: "trigger", label: "Trigger", type: "output" }],
  },
  {
    type: "task_event",
    category: "trigger",
    label: "Task Event",
    description: "Trigger a pipeline when specific task events occur.",
    icon: "zap",
    configFields: [
      {
        key: "eventFilter",
        label: "Events",
        type: "select",
        required: true,
        options: ["completed", "failed", "approval_required", "input_required"],
      },
    ],
    ports: [{ id: "trigger", label: "Trigger", type: "output" }],
  },
  {
    type: "manual",
    category: "trigger",
    label: "Manual Trigger",
    description: "Manually start a pipeline with optional label override.",
    icon: "play",
    configFields: [],
    ports: [{ id: "trigger", label: "Trigger", type: "output" }],
  },

  // -------------------------------------------------------------------------
  // PROCESSING
  // -------------------------------------------------------------------------
  {
    type: "agent",
    category: "processing",
    label: "Agent",
    description: "Run an AI agent with a prompt, model, and optional skills/credentials.",
    icon: "bot",
    configFields: [
      { key: "prompt", label: "Prompt", type: "code", required: true },
      { key: "model", label: "Model", type: "string" },
      { key: "skills", label: "Skills", type: "string", placeholder: "skill-a, skill-b" },
      { key: "credentials", label: "Credentials", type: "string", placeholder: "cred-a, cred-b" },
      {
        key: "policyPreset",
        label: "Policy Preset",
        type: "select",
        options: ["research", "coding", "messaging", "full"],
      },
      {
        key: "sessionTarget",
        label: "Session Target",
        type: "select",
        options: ["isolated", "main"],
        defaultValue: "isolated",
      },
      {
        key: "thinking",
        label: "Thinking Level",
        type: "select",
        options: ["off", "minimal", "medium", "high"],
        defaultValue: "off",
      },
      { key: "timeout", label: "Timeout (s)", type: "number", defaultValue: 300 },
    ],
    ports: [
      { id: "in", label: "Input", type: "input" },
      { id: "success", label: "Success", type: "output" },
      { id: "failure", label: "Failure", type: "output" },
    ],
  },
  {
    type: "app",
    category: "processing",
    label: "App",
    description: "Start a remote app and direct an agent to interact with it.",
    icon: "app-window",
    configFields: [
      { key: "appId", label: "App", type: "string", required: true },
      { key: "prompt", label: "Prompt", type: "code", required: true },
      {
        key: "sessionTarget",
        label: "Session Target",
        type: "select",
        options: ["isolated", "main"],
        defaultValue: "isolated",
      },
      {
        key: "lifecycle",
        label: "Lifecycle",
        type: "select",
        options: ["keep-alive", "ephemeral"],
        defaultValue: "keep-alive",
      },
      { key: "timeout", label: "Timeout (s)", type: "number", defaultValue: 300 },
    ],
    ports: [
      { id: "in", label: "Input", type: "input" },
      { id: "success", label: "Success", type: "output" },
      { id: "failure", label: "Failure", type: "output" },
    ],
  },
  {
    type: "condition",
    category: "processing",
    label: "Condition",
    description: "Branch pipeline flow based on an expression.",
    icon: "git-branch",
    configFields: [
      { key: "expression", label: "Expression", type: "code", required: true },
      { key: "outputs", label: "Output Labels", type: "string", defaultValue: "true,false" },
    ],
    ports: [
      { id: "in", label: "Input", type: "input" },
      { id: "true", label: "True", type: "output" },
      { id: "false", label: "False", type: "output" },
    ],
  },
  {
    type: "approval",
    category: "processing",
    label: "Approval Gate",
    description: "Pause execution until a human approves or denies the step.",
    icon: "shield-check",
    configFields: [
      { key: "message", label: "Message", type: "string", required: true },
      { key: "timeoutSec", label: "Timeout (s)", type: "number" },
    ],
    ports: [
      { id: "in", label: "Input", type: "input" },
      { id: "approved", label: "Approved", type: "output" },
      { id: "denied", label: "Denied", type: "output" },
    ],
  },
  {
    type: "loop",
    category: "processing",
    label: "Loop",
    description:
      "Repeat a sub-graph up to a maximum number of iterations or until a condition is met.",
    icon: "repeat",
    configFields: [
      {
        key: "maxIterations",
        label: "Max Iterations",
        type: "number",
        required: true,
        defaultValue: 10,
      },
      { key: "condition", label: "Condition", type: "code" },
    ],
    ports: [
      { id: "in", label: "Input", type: "input" },
      { id: "body", label: "Body", type: "output" },
      { id: "done", label: "Done", type: "output" },
    ],
  },
  {
    type: "code",
    category: "processing",
    label: "Code",
    description: "Agent writes and executes code in any language with pipeline variables.",
    icon: "terminal",
    configFields: [
      { key: "description", label: "What should this code do?", type: "code", required: true },
      {
        key: "language",
        label: "Preferred Language",
        type: "select",
        options: ["auto", "javascript", "typescript", "python", "bash", "ruby", "go"],
        defaultValue: "auto",
      },
      { key: "maxRetries", label: "Max Retries", type: "number", defaultValue: 3 },
      { key: "timeout", label: "Timeout (s)", type: "number", defaultValue: 120 },
    ],
    ports: [
      { id: "in", label: "Input", type: "input" },
      { id: "success", label: "Success", type: "output" },
      { id: "failure", label: "Failure", type: "output" },
    ],
  },

  // -------------------------------------------------------------------------
  // ACTIONS
  // -------------------------------------------------------------------------
  {
    type: "notify",
    category: "action",
    label: "Send Notification",
    description: "Send a notification through one or more channels.",
    icon: "bell",
    configFields: [
      {
        key: "channels",
        label: "Channels",
        type: "string",
        required: true,
        placeholder: "discord, slack",
      },
      { key: "template", label: "Message", type: "code", required: true },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        options: ["low", "medium", "high", "critical"],
        defaultValue: "medium",
      },
    ],
    ports: [
      { id: "in", label: "Input", type: "input" },
      { id: "out", label: "Output", type: "output" },
    ],
  },
  {
    type: "output",
    category: "action",
    label: "Output",
    description: "Write pipeline results to a variable, file, or log.",
    icon: "download",
    configFields: [
      {
        key: "destination",
        label: "Target",
        type: "select",
        required: true,
        options: ["variable", "file", "log"],
      },
      { key: "path", label: "Key / Path", type: "string" },
      {
        key: "format",
        label: "Format",
        type: "select",
        options: ["json", "text", "markdown"],
        defaultValue: "json",
      },
    ],
    ports: [{ id: "in", label: "Input", type: "input" }],
  },
];

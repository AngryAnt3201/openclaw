import { describe, it, expect } from "vitest";
import type {
  Pipeline,
  PipelineNode,
  PipelineEdge,
  PipelineRun,
  PipelineStoreFile,
  PipelineCreate,
  PipelinePatch,
  AgentNodeConfig,
  CronTriggerConfig,
  ConditionConfig,
  NotifyConfig,
  OutputConfig,
  NodeDefinition,
  NodeConfigField,
  PortDefinition,
  PipelineEvent,
  PipelineNodeState,
  PipelineRunNodeResult,
  WebhookTriggerConfig,
  TaskEventTriggerConfig,
  ManualTriggerConfig,
  ApprovalConfig,
  LoopConfig,
} from "./types.js";
import {
  TRIGGER_NODE_TYPES,
  PROCESSING_NODE_TYPES,
  ACTION_NODE_TYPES,
  NODE_CATEGORIES,
  NODE_STATUSES,
  PIPELINE_STATUSES,
  PIPELINE_RUN_STATUSES,
  VALID_TRIGGER_NODE_TYPES,
  VALID_PROCESSING_NODE_TYPES,
  VALID_ACTION_NODE_TYPES,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNodeState(overrides?: Partial<PipelineNodeState>): PipelineNodeState {
  return { status: "idle", retryCount: 0, ...overrides };
}

function makeAgentConfig(overrides?: Partial<AgentNodeConfig>): AgentNodeConfig {
  return {
    prompt: "Summarize the latest commit",
    credentials: [],
    tools: [],
    session: "isolated",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Pipeline Core Types", () => {
  // =========================================================================
  // Const arrays and runtime sets
  // =========================================================================

  describe("const arrays", () => {
    it("should expose trigger node types", () => {
      expect(TRIGGER_NODE_TYPES).toContain("cron");
      expect(TRIGGER_NODE_TYPES).toContain("webhook");
      expect(TRIGGER_NODE_TYPES).toContain("task_event");
      expect(TRIGGER_NODE_TYPES).toContain("manual");
      expect(TRIGGER_NODE_TYPES).toHaveLength(4);
    });

    it("should expose processing node types", () => {
      expect(PROCESSING_NODE_TYPES).toContain("agent");
      expect(PROCESSING_NODE_TYPES).toContain("app");
      expect(PROCESSING_NODE_TYPES).toContain("condition");
      expect(PROCESSING_NODE_TYPES).toContain("approval");
      expect(PROCESSING_NODE_TYPES).toContain("loop");
      expect(PROCESSING_NODE_TYPES).toContain("code");
      expect(PROCESSING_NODE_TYPES).toHaveLength(6);
    });

    it("should expose action node types", () => {
      expect(ACTION_NODE_TYPES).toContain("notify");
      expect(ACTION_NODE_TYPES).toContain("output");
      expect(ACTION_NODE_TYPES).toHaveLength(2);
    });

    it("should expose node categories", () => {
      expect(NODE_CATEGORIES).toEqual(["trigger", "processing", "action"]);
    });

    it("should expose node statuses", () => {
      expect(NODE_STATUSES).toContain("idle");
      expect(NODE_STATUSES).toContain("running");
      expect(NODE_STATUSES).toContain("success");
      expect(NODE_STATUSES).toContain("failed");
      expect(NODE_STATUSES).toContain("skipped");
      expect(NODE_STATUSES).toContain("waiting");
      expect(NODE_STATUSES).toHaveLength(6);
    });

    it("should expose pipeline statuses", () => {
      expect(PIPELINE_STATUSES).toContain("draft");
      expect(PIPELINE_STATUSES).toContain("active");
      expect(PIPELINE_STATUSES).toContain("paused");
      expect(PIPELINE_STATUSES).toContain("error");
      expect(PIPELINE_STATUSES).toContain("archived");
      expect(PIPELINE_STATUSES).toHaveLength(5);
    });

    it("should expose pipeline run statuses", () => {
      expect(PIPELINE_RUN_STATUSES).toContain("pending");
      expect(PIPELINE_RUN_STATUSES).toContain("running");
      expect(PIPELINE_RUN_STATUSES).toContain("success");
      expect(PIPELINE_RUN_STATUSES).toContain("failed");
      expect(PIPELINE_RUN_STATUSES).toContain("cancelled");
      expect(PIPELINE_RUN_STATUSES).toHaveLength(5);
    });
  });

  describe("runtime validation sets", () => {
    it("should allow O(1) validation of trigger node types", () => {
      expect(VALID_TRIGGER_NODE_TYPES.has("cron")).toBe(true);
      expect(VALID_TRIGGER_NODE_TYPES.has("webhook")).toBe(true);
      expect(VALID_TRIGGER_NODE_TYPES.has("nonexistent")).toBe(false);
    });

    it("should allow O(1) validation of processing node types", () => {
      expect(VALID_PROCESSING_NODE_TYPES.has("agent")).toBe(true);
      expect(VALID_PROCESSING_NODE_TYPES.has("condition")).toBe(true);
      expect(VALID_PROCESSING_NODE_TYPES.has("nonexistent")).toBe(false);
    });

    it("should allow O(1) validation of action node types", () => {
      expect(VALID_ACTION_NODE_TYPES.has("notify")).toBe(true);
      expect(VALID_ACTION_NODE_TYPES.has("output")).toBe(true);
      expect(VALID_ACTION_NODE_TYPES.has("nonexistent")).toBe(false);
    });
  });

  // =========================================================================
  // Pipeline construction
  // =========================================================================

  describe("Pipeline", () => {
    it("should construct a valid Pipeline", () => {
      const pipeline: Pipeline = {
        id: "pipe-001",
        name: "Daily Digest",
        description: "Sends a daily summary of task completions",
        enabled: true,
        nodes: [],
        edges: [],
        status: "active",
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAtMs: 1700000000000,
        updatedAtMs: 1700000000000,
        runCount: 0,
      };

      expect(pipeline.id).toBe("pipe-001");
      expect(pipeline.name).toBe("Daily Digest");
      expect(pipeline.enabled).toBe(true);
      expect(pipeline.status).toBe("active");
      expect(pipeline.nodes).toHaveLength(0);
      expect(pipeline.edges).toHaveLength(0);
      expect(pipeline.viewport.zoom).toBe(1);
      expect(pipeline.runCount).toBe(0);
    });

    it("should construct a Pipeline with nodes and edges", () => {
      const cronNode: PipelineNode = {
        id: "node-1",
        type: "cron",
        label: "Every hour",
        config: { schedule: "0 * * * *" } satisfies CronTriggerConfig,
        position: { x: 100, y: 200 },
        state: makeNodeState(),
      };

      const agentNode: PipelineNode = {
        id: "node-2",
        type: "agent",
        label: "Summarizer",
        config: makeAgentConfig({ prompt: "Summarize new issues" }),
        position: { x: 300, y: 200 },
        state: makeNodeState(),
      };

      const edge: PipelineEdge = {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
      };

      const pipeline: Pipeline = {
        id: "pipe-002",
        name: "Issue Digest",
        description: "",
        enabled: true,
        nodes: [cronNode, agentNode],
        edges: [edge],
        status: "active",
        viewport: { x: 0, y: 0, zoom: 1 },
        createdAtMs: 1700000000000,
        updatedAtMs: 1700000000000,
        runCount: 5,
      };

      expect(pipeline.nodes).toHaveLength(2);
      expect(pipeline.edges).toHaveLength(1);
      expect(pipeline.nodes[0].type).toBe("cron");
      expect(pipeline.nodes[1].type).toBe("agent");
      expect(pipeline.runCount).toBe(5);
    });
  });

  // =========================================================================
  // Node configs
  // =========================================================================

  describe("node configs", () => {
    it("should construct AgentNodeConfig with all fields", () => {
      const config: AgentNodeConfig = {
        model: "claude-opus-4-20250514",
        prompt: "Review the PR and summarize changes",
        tools: ["code-review", "summarize"],
        credentials: ["cred-github", "cred-anthropic"],
        apps: ["my-app"],
        session: "isolated",
        thinking: "enabled",
        timeout: 300,
      };

      expect(config.prompt).toBe("Review the PR and summarize changes");
      expect(config.tools).toEqual(["code-review", "summarize"]);
      expect(config.credentials).toEqual(["cred-github", "cred-anthropic"]);
      expect(config.session).toBe("isolated");
      expect(config.thinking).toBe("enabled");
      expect(config.timeout).toBe(300);
    });

    it("should construct AgentNodeConfig with minimal required fields", () => {
      const config: AgentNodeConfig = {
        prompt: "Do something",
      };

      expect(config.model).toBeUndefined();
      expect(config.tools).toBeUndefined();
      expect(config.credentials).toBeUndefined();
      expect(config.session).toBeUndefined();
      expect(config.thinking).toBeUndefined();
      expect(config.timeout).toBeUndefined();
    });

    it("should construct CronTriggerConfig", () => {
      const config: CronTriggerConfig = {
        schedule: "*/15 * * * *",
        timezone: "America/New_York",
      };
      expect(config.schedule).toBe("*/15 * * * *");
      expect(config.timezone).toBe("America/New_York");
    });

    it("should construct WebhookTriggerConfig", () => {
      const config: WebhookTriggerConfig = {
        path: "/hooks/deploy",
        secret: "wh-secret-123",
        method: "POST",
      };
      expect(config.path).toBe("/hooks/deploy");
      expect(config.method).toBe("POST");
    });

    it("should construct TaskEventTriggerConfig", () => {
      const config: TaskEventTriggerConfig = {
        eventFilter: "status_change",
        taskType: "coding",
        taskStatus: "complete",
      };
      expect(config.eventFilter).toBe("status_change");
      expect(config.taskType).toBe("coding");
    });

    it("should construct ManualTriggerConfig", () => {
      const config: ManualTriggerConfig = {
        label: "Run Now",
      };
      expect(config.label).toBe("Run Now");
    });

    it("should construct ConditionConfig", () => {
      const config: ConditionConfig = {
        expression: "input.status === 'success'",
        trueLabel: "Continue",
        falseLabel: "Skip",
      };
      expect(config.expression).toBe("input.status === 'success'");
      expect(config.trueLabel).toBe("Continue");
    });

    it("should construct ApprovalConfig", () => {
      const config: ApprovalConfig = {
        approverIds: ["user-1"],
        message: "Please approve deployment",
        timeout: 3600,
        timeoutAction: "deny",
      };
      expect(config.timeoutAction).toBe("deny");
      expect(config.timeout).toBe(3600);
    });

    it("should construct LoopConfig", () => {
      const config: LoopConfig = {
        maxIterations: 10,
        condition: "result.hasMore === true",
      };
      expect(config.maxIterations).toBe(10);
      expect(config.condition).toBe("result.hasMore === true");
    });

    it("should construct NotifyConfig", () => {
      const config: NotifyConfig = {
        channels: ["discord", "slack"],
        message: "Pipeline {{name}} completed",
        priority: "high",
      };
      expect(config.channels).toHaveLength(2);
      expect(config.message).toBe("Pipeline {{name}} completed");
    });

    it("should construct OutputConfig", () => {
      const config: OutputConfig = {
        format: "json",
        destination: "file",
        path: "/tmp/results.json",
      };
      expect(config.format).toBe("json");
      expect(config.destination).toBe("file");
    });
  });

  // =========================================================================
  // Edges
  // =========================================================================

  describe("PipelineEdge", () => {
    it("should construct a minimal edge", () => {
      const edge: PipelineEdge = {
        id: "edge-1",
        source: "node-a",
        target: "node-b",
      };
      expect(edge.source).toBe("node-a");
      expect(edge.target).toBe("node-b");
      expect(edge.condition).toBeUndefined();
    });

    it("should construct an edge with condition and handles", () => {
      const edge: PipelineEdge = {
        id: "edge-2",
        source: "condition-1",
        sourceHandle: "true",
        target: "agent-1",
        targetHandle: "input",
        condition: "result.approved === true",
      };
      expect(edge.sourceHandle).toBe("true");
      expect(edge.targetHandle).toBe("input");
      expect(edge.condition).toBe("result.approved === true");
    });
  });

  // =========================================================================
  // Pipeline Run
  // =========================================================================

  describe("PipelineRun", () => {
    it("should construct a valid PipelineRun", () => {
      const nodeResult: PipelineRunNodeResult = {
        nodeId: "node-1",
        status: "success",
        startedAtMs: 1700000000000,
        completedAtMs: 1700000005000,
        output: { summary: "All tests passed" },
      };

      const run: PipelineRun = {
        id: "run-001",
        pipelineId: "pipe-001",
        status: "success",
        trigger: "cron",
        triggerData: { schedule: "0 * * * *" },
        nodeResults: [nodeResult],
        startedAtMs: 1700000000000,
        completedAtMs: 1700000010000,
      };

      expect(run.id).toBe("run-001");
      expect(run.status).toBe("success");
      expect(run.nodeResults).toHaveLength(1);
      expect(run.nodeResults[0].output).toEqual({ summary: "All tests passed" });
      expect(run.error).toBeUndefined();
    });

    it("should construct a failed PipelineRun", () => {
      const run: PipelineRun = {
        id: "run-002",
        pipelineId: "pipe-001",
        status: "failed",
        trigger: "manual",
        nodeResults: [{ nodeId: "node-1", status: "failed", error: "Timeout exceeded" }],
        startedAtMs: 1700000000000,
        completedAtMs: 1700000060000,
        error: "Node node-1 failed: Timeout exceeded",
      };

      expect(run.status).toBe("failed");
      expect(run.error).toContain("Timeout");
    });
  });

  // =========================================================================
  // Store file
  // =========================================================================

  describe("PipelineStoreFile", () => {
    it("should construct a valid store file", () => {
      const store: PipelineStoreFile = {
        version: 1,
        pipelines: [],
      };
      expect(store.version).toBe(1);
      expect(store.pipelines).toHaveLength(0);
    });
  });

  // =========================================================================
  // CRUD helpers
  // =========================================================================

  describe("CRUD helpers", () => {
    it("should construct a PipelineCreate", () => {
      const input: PipelineCreate = {
        name: "New Pipeline",
        description: "A test pipeline",
      };
      expect(input.name).toBe("New Pipeline");
      expect(input.enabled).toBeUndefined();
      expect(input.nodes).toBeUndefined();
    });

    it("should construct a PipelinePatch", () => {
      const patch: PipelinePatch = {
        name: "Updated Name",
        enabled: false,
        status: "paused",
      };
      expect(patch.name).toBe("Updated Name");
      expect(patch.enabled).toBe(false);
      expect(patch.status).toBe("paused");
    });
  });

  // =========================================================================
  // Node registry types
  // =========================================================================

  describe("NodeDefinition", () => {
    it("should construct a NodeDefinition for registry", () => {
      const field: NodeConfigField = {
        key: "schedule",
        label: "Cron Schedule",
        type: "string",
        required: true,
        placeholder: "0 * * * *",
      };

      const inputPort: PortDefinition = {
        id: "in",
        label: "Input",
        type: "input",
      };

      const outputPort: PortDefinition = {
        id: "out",
        label: "Output",
        type: "output",
      };

      const definition: NodeDefinition = {
        type: "cron",
        category: "trigger",
        label: "Cron Trigger",
        description: "Runs on a cron schedule",
        icon: "clock",
        configFields: [field],
        ports: [inputPort, outputPort],
      };

      expect(definition.type).toBe("cron");
      expect(definition.category).toBe("trigger");
      expect(definition.configFields).toHaveLength(1);
      expect(definition.configFields[0].required).toBe(true);
      expect(definition.ports).toHaveLength(2);
      expect(definition.executor).toBeUndefined();
    });

    it("should allow a NodeDefinition with an executor function", () => {
      const definition: NodeDefinition = {
        type: "agent",
        category: "processing",
        label: "Agent",
        description: "Runs an AI agent",
        configFields: [],
        ports: [
          { id: "in", label: "Input", type: "input" },
          { id: "out", label: "Output", type: "output" },
        ],
        executor: async (_node, inputs, _ctx) => {
          return { result: `processed ${Object.keys(inputs).length} inputs` };
        },
      };

      expect(definition.executor).toBeDefined();
      expect(typeof definition.executor).toBe("function");
    });

    it("should support custom node types in NodeDefinition", () => {
      const definition: NodeDefinition = {
        type: "my_custom_transform",
        category: "processing",
        label: "Custom Transform",
        description: "A user-defined node type",
        configFields: [
          {
            key: "script",
            label: "Script",
            type: "code",
            required: true,
          },
        ],
        ports: [
          { id: "in", label: "Input", type: "input" },
          { id: "out", label: "Output", type: "output" },
        ],
      };

      expect(definition.type).toBe("my_custom_transform");
    });
  });

  // =========================================================================
  // Events
  // =========================================================================

  describe("PipelineEvent", () => {
    it("should construct a pipeline event", () => {
      const event: PipelineEvent = {
        id: "evt-001",
        pipelineId: "pipe-001",
        runId: "run-001",
        nodeId: "node-1",
        type: "node_completed",
        timestamp: 1700000005000,
        message: "Node completed successfully",
        data: { duration: 5000 },
      };

      expect(event.type).toBe("node_completed");
      expect(event.pipelineId).toBe("pipe-001");
      expect(event.runId).toBe("run-001");
      expect(event.data).toEqual({ duration: 5000 });
    });

    it("should construct a minimal pipeline event", () => {
      const event: PipelineEvent = {
        id: "evt-002",
        pipelineId: "pipe-001",
        type: "pipeline_created",
        timestamp: 1700000000000,
        message: "Pipeline created",
      };

      expect(event.runId).toBeUndefined();
      expect(event.nodeId).toBeUndefined();
      expect(event.data).toBeUndefined();
    });
  });

  // =========================================================================
  // Node state
  // =========================================================================

  describe("PipelineNodeState", () => {
    it("should construct an idle state", () => {
      const state: PipelineNodeState = makeNodeState();
      expect(state.status).toBe("idle");
      expect(state.retryCount).toBe(0);
      expect(state.error).toBeUndefined();
    });

    it("should construct a failed state with error", () => {
      const state: PipelineNodeState = makeNodeState({
        status: "failed",
        startedAtMs: 1700000000000,
        completedAtMs: 1700000005000,
        error: "Connection timeout",
        retryCount: 2,
      });
      expect(state.status).toBe("failed");
      expect(state.error).toBe("Connection timeout");
      expect(state.retryCount).toBe(2);
    });
  });
});

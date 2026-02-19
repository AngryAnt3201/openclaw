// ---------------------------------------------------------------------------
// Pipeline Executor – Trigger Registration
// ---------------------------------------------------------------------------
// Manages the lifecycle of trigger registrations: when a pipeline is activated
// its trigger nodes are registered with the appropriate services (cron, webhook,
// task events), and when deactivated those registrations are torn down.
// ---------------------------------------------------------------------------

import type {
  CronTriggerConfig,
  Pipeline,
  PipelineNode,
  TaskEventTriggerConfig,
  WebhookTriggerConfig,
} from "../types.js";
import type { ExecutorContext } from "./types.js";
import { VALID_TRIGGER_NODE_TYPES } from "../types.js";

// ---------------------------------------------------------------------------
// Extended context with service handles
// ---------------------------------------------------------------------------

export type TriggerRegistrationContext = ExecutorContext & {
  cronService?: {
    add: (job: unknown) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
  };
  // Placeholder for future services
  // webhookService?: { register: (...) => ...; unregister: (...) => ... };
  // taskEventService?: { on: (...) => ...; off: (...) => ... };
};

// ---------------------------------------------------------------------------
// Cron job ID derivation — deterministic from pipeline + node IDs
// ---------------------------------------------------------------------------

function cronJobId(pipelineId: string, nodeId: string): string {
  return `pipeline:${pipelineId}:${nodeId}`;
}

// ---------------------------------------------------------------------------
// registerPipelineTriggers
// ---------------------------------------------------------------------------

export async function registerPipelineTriggers(
  pipeline: Pipeline,
  context: TriggerRegistrationContext,
): Promise<{ registeredTriggers: string[] }> {
  const triggerNodes = pipeline.nodes.filter((n) => VALID_TRIGGER_NODE_TYPES.has(n.type));

  const registered: string[] = [];

  for (const node of triggerNodes) {
    try {
      const didRegister = await registerTriggerNode(pipeline, node, context);
      if (didRegister) {
        registered.push(node.id);
      }
    } catch (err) {
      context.log?.error(
        `Failed to register trigger node ${node.id} for pipeline ${pipeline.id}:`,
        err,
      );
    }
  }

  return { registeredTriggers: registered };
}

// ---------------------------------------------------------------------------
// unregisterPipelineTriggers
// ---------------------------------------------------------------------------

export async function unregisterPipelineTriggers(
  pipeline: Pipeline,
  context: TriggerRegistrationContext,
): Promise<void> {
  const triggerNodes = pipeline.nodes.filter((n) => VALID_TRIGGER_NODE_TYPES.has(n.type));

  for (const node of triggerNodes) {
    try {
      await unregisterTriggerNode(pipeline, node, context);
    } catch (err) {
      context.log?.error(
        `Failed to unregister trigger node ${node.id} for pipeline ${pipeline.id}:`,
        err,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Per-type registration
// ---------------------------------------------------------------------------

async function registerTriggerNode(
  pipeline: Pipeline,
  node: PipelineNode,
  context: TriggerRegistrationContext,
): Promise<boolean> {
  switch (node.type) {
    case "cron":
      return await registerCronTrigger(pipeline, node, context);

    case "webhook":
      return registerWebhookTrigger(pipeline, node, context);

    case "task_event":
      return registerTaskEventTrigger(pipeline, node, context);

    case "manual":
      // Manual triggers need no registration.
      return false;

    default:
      context.log?.info(`Unsupported trigger type "${node.type}" on node ${node.id}`);
      return false;
  }
}

async function unregisterTriggerNode(
  pipeline: Pipeline,
  node: PipelineNode,
  context: TriggerRegistrationContext,
): Promise<void> {
  switch (node.type) {
    case "cron":
      await unregisterCronTrigger(pipeline, node, context);
      break;
    case "webhook":
      // Placeholder: webhook unregistration
      break;
    case "task_event":
      // Placeholder: task event listener removal
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Cron triggers
// ---------------------------------------------------------------------------

async function registerCronTrigger(
  pipeline: Pipeline,
  node: PipelineNode,
  context: TriggerRegistrationContext,
): Promise<boolean> {
  if (!context.cronService) {
    context.log?.info("Cron service not available — skipping cron trigger registration");
    return false;
  }

  const config = node.config as CronTriggerConfig;
  const jobId = cronJobId(pipeline.id, node.id);

  await context.cronService.add({
    id: jobId,
    name: `Pipeline: ${pipeline.name} — ${node.label}`,
    enabled: true,
    schedule: { kind: "cron", expr: config.schedule, tz: config.timezone },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: {
      kind: "systemEvent",
      text: `[pipeline:trigger] Pipeline "${pipeline.name}" triggered by cron node "${node.label}" (${node.id})`,
    },
    // Tag so we can find and remove pipeline-generated cron jobs.
    description: `Auto-generated by pipeline ${pipeline.id}`,
  });

  return true;
}

async function unregisterCronTrigger(
  pipeline: Pipeline,
  node: PipelineNode,
  context: TriggerRegistrationContext,
): Promise<void> {
  if (!context.cronService) {
    return;
  }

  const jobId = cronJobId(pipeline.id, node.id);
  try {
    await context.cronService.remove(jobId);
  } catch {
    // Job may not exist if registration was partial — safe to ignore.
  }
}

// ---------------------------------------------------------------------------
// Webhook triggers (placeholder)
// ---------------------------------------------------------------------------

function registerWebhookTrigger(
  _pipeline: Pipeline,
  node: PipelineNode,
  context: TriggerRegistrationContext,
): boolean {
  const _config = node.config as WebhookTriggerConfig;
  context.log?.info(
    `Webhook trigger registration for node ${node.id} is a placeholder — not yet implemented`,
  );
  return false;
}

// ---------------------------------------------------------------------------
// Task event triggers (placeholder)
// ---------------------------------------------------------------------------

function registerTaskEventTrigger(
  _pipeline: Pipeline,
  node: PipelineNode,
  context: TriggerRegistrationContext,
): boolean {
  const _config = node.config as TaskEventTriggerConfig;
  context.log?.info(
    `Task event trigger registration for node ${node.id} is a placeholder — not yet implemented`,
  );
  return false;
}

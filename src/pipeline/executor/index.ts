// ---------------------------------------------------------------------------
// Pipeline Executor – Barrel Export
// ---------------------------------------------------------------------------

export type { ExecutorContext, NodeExecutionResult, NodeExecutorFn } from "./types.js";

export { executeAgentNode } from "./agent.js";
export { executeConditionNode } from "./condition.js";
export { executeNotifyNode, executeGithubNode, executeOutputNode } from "./action.js";
export type { TriggerRegistrationContext } from "./trigger.js";
export { registerPipelineTriggers, unregisterPipelineTriggers } from "./trigger.js";

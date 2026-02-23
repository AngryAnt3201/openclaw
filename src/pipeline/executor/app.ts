import type { AppNodeConfig, PipelineNode } from "../types.js";
import type { ExecutorContext, NodeExecutionResult, NodeExecutorFn } from "./types.js";

const DEFAULT_TIMEOUT_SEC = 300;
const HEALTH_POLL_INTERVAL_MS = 1000;
const HEALTH_POLL_MAX_MS = 30_000;

export const executeAppNode: NodeExecutorFn = async (
  node: PipelineNode,
  input: unknown,
  context: ExecutorContext,
): Promise<NodeExecutionResult> => {
  const startMs = Date.now();
  const config = node.config as AppNodeConfig;

  if (!config.appId) {
    return {
      status: "failure",
      error: "App node requires an appId",
      durationMs: Date.now() - startMs,
    };
  }
  if (!config.prompt) {
    return {
      status: "failure",
      error: "App node requires a prompt",
      durationMs: Date.now() - startMs,
    };
  }
  if (!context.callGatewayRpc) {
    return {
      status: "failure",
      error: "callGatewayRpc not available in executor context",
      durationMs: Date.now() - startMs,
    };
  }

  try {
    // 1. Look up the app
    const app = (await context.callGatewayRpc("launcher.get", { appId: config.appId })) as {
      id: string;
      name: string;
      description?: string;
      port?: number;
    } | null;
    if (!app) {
      return {
        status: "failure",
        error: `App not found: ${config.appId}`,
        durationMs: Date.now() - startMs,
      };
    }

    // 2. Ensure running — check health, start if needed
    const health = (await context.callGatewayRpc("launcher.health", { appId: config.appId })) as {
      healthy: boolean;
    } | null;
    let startResult: { proxyUrl?: string } | null = null;
    if (!health?.healthy) {
      startResult = (await context.callGatewayRpc("launcher.start", { appId: config.appId })) as {
        proxyUrl?: string;
      } | null;
      await pollHealth(context, config.appId);
    }

    // 3. Build proxy URL + agent prompt
    const proxyUrl =
      startResult?.proxyUrl ??
      ((app as Record<string, unknown>).proxy_url as string | undefined) ??
      `http://127.0.0.1:${app.port ?? 3000}`;
    const prompt = buildAppPrompt(app, proxyUrl, config.prompt, input);

    // 4. Execute via agent session
    let agentResult: unknown;
    if (config.sessionTarget === "main") {
      context.enqueueSystemEvent?.(prompt, {});
      context.requestHeartbeatNow?.({ reason: "pipeline:app" });
      agentResult = { dispatched: true, sessionTarget: "main" };
    } else {
      if (!context.runIsolatedAgentJob) {
        return {
          status: "failure",
          error: "runIsolatedAgentJob not available",
          durationMs: Date.now() - startMs,
        };
      }
      agentResult = await context.runIsolatedAgentJob({
        message: prompt,
        timeoutSeconds: config.timeout ?? DEFAULT_TIMEOUT_SEC,
        previousOutput: input,
      });
    }

    // 5. Ephemeral lifecycle: stop after execution
    if (config.lifecycle === "ephemeral") {
      await context.callGatewayRpc("launcher.stop", { appId: config.appId });
    }

    const status = isAgentOk(agentResult) ? "success" : "failure";
    return {
      status,
      output: agentResult,
      error: status === "failure" ? extractError(agentResult) : undefined,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    context.log?.error("Pipeline app node failed:", err);
    return {
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startMs,
    };
  }
};

async function pollHealth(context: ExecutorContext, appId: string): Promise<void> {
  const deadline = Date.now() + HEALTH_POLL_MAX_MS;
  while (Date.now() < deadline) {
    await sleep(HEALTH_POLL_INTERVAL_MS);
    if (!context.callGatewayRpc) {
      throw new Error("callGatewayRpc not available");
    }
    const h = (await context.callGatewayRpc("launcher.health", { appId })) as {
      healthy: boolean;
    } | null;
    if (h?.healthy) {
      return;
    }
  }
  throw new Error(`App "${appId}" did not become healthy within ${HEALTH_POLL_MAX_MS / 1000}s`);
}

function buildAppPrompt(
  app: { name: string; description?: string },
  proxyUrl: string,
  prompt: string,
  input: unknown,
): string {
  const parts: string[] = [];
  parts.push(`You have access to the app "${app.name}" at ${proxyUrl}.`);
  if (app.description) {
    parts.push(`Description: ${app.description}`);
  }
  parts.push("");
  if (input !== undefined && input !== null) {
    const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    if (inputStr && inputStr !== "{}" && inputStr !== "null") {
      parts.push(`[Pipeline context — previous node output]\n${inputStr}\n`);
    }
  }
  parts.push(`Task: ${prompt}`);
  return parts.join("\n");
}

function isAgentOk(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return true;
  }
  return (result as Record<string, unknown>).status !== "error";
}

function extractError(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const r = result as Record<string, unknown>;
  return typeof r.error === "string" ? r.error : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

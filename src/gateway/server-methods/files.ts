import type { GatewayRequestHandlers } from "./types.js";
import { loadConfig } from "../../config/config.js";
import { handleFileList, handleFileRead, handleFileStat } from "../../node-host/file-commands.js";
import { isNodeCommandAllowed, resolveNodeCommandAllowlist } from "../node-command-policy.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { respondUnavailableOnThrow, safeParseJson } from "./nodes.helpers.js";

const LOCAL_NODE_ID = "local";

function isLocal(nodeId: string): boolean {
  return nodeId === LOCAL_NODE_ID || nodeId === "";
}

async function invokeFileCommand(params: {
  context: Parameters<GatewayRequestHandlers[string]>[0]["context"];
  respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"];
  nodeId: string;
  command: string;
  commandParams: unknown;
}) {
  const { context, respond, nodeId, command, commandParams } = params;

  const nodeSession = context.nodeRegistry.get(nodeId);
  if (!nodeSession) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "node not connected", {
        details: { code: "NOT_CONNECTED" },
      }),
    );
    return;
  }

  const cfg = loadConfig();
  const allowlist = resolveNodeCommandAllowlist(cfg, nodeSession);
  const allowed = isNodeCommandAllowed({
    command,
    declaredCommands: nodeSession.commands,
    allowlist,
  });
  if (!allowed.ok) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "file command not allowed", {
        details: { reason: allowed.reason, command },
      }),
    );
    return;
  }

  const result = await context.nodeRegistry.invoke({
    nodeId,
    command,
    params: commandParams,
    timeoutMs: 30_000,
  });

  if (!result.ok) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, result.error?.message ?? "file command failed", {
        details: { nodeError: result.error ?? null },
      }),
    );
    return;
  }

  const payload = result.payloadJSON ? safeParseJson(result.payloadJSON) : result.payload;
  respond(true, payload, undefined);
}

export const fileHandlers: GatewayRequestHandlers = {
  "file.list": async ({ params, respond, context }) => {
    const p = params as {
      nodeId?: string;
      path?: string;
      hidden?: boolean;
      limit?: number;
    };
    const nodeId = typeof p.nodeId === "string" ? p.nodeId.trim() : "";
    const filePath = typeof p.path === "string" ? p.path.trim() : "";
    if (!filePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path required"));
      return;
    }

    // Local gateway filesystem
    if (isLocal(nodeId)) {
      await respondUnavailableOnThrow(respond, async () => {
        const result = await handleFileList({ path: filePath, hidden: p.hidden, limit: p.limit });
        respond(true, result, undefined);
      });
      return;
    }

    await respondUnavailableOnThrow(respond, async () => {
      await invokeFileCommand({
        context,
        respond,
        nodeId,
        command: "file.list",
        commandParams: { path: filePath, hidden: p.hidden, limit: p.limit },
      });
    });
  },

  "file.read": async ({ params, respond, context }) => {
    const p = params as {
      nodeId?: string;
      path?: string;
      offset?: number;
      limit?: number;
      encoding?: "utf8" | "base64";
    };
    const nodeId = typeof p.nodeId === "string" ? p.nodeId.trim() : "";
    const filePath = typeof p.path === "string" ? p.path.trim() : "";
    if (!filePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path required"));
      return;
    }

    // Local gateway filesystem
    if (isLocal(nodeId)) {
      await respondUnavailableOnThrow(respond, async () => {
        const result = await handleFileRead({
          path: filePath,
          offset: p.offset,
          limit: p.limit,
          encoding: p.encoding,
        });
        respond(true, result, undefined);
      });
      return;
    }

    await respondUnavailableOnThrow(respond, async () => {
      await invokeFileCommand({
        context,
        respond,
        nodeId,
        command: "file.read",
        commandParams: { path: filePath, offset: p.offset, limit: p.limit, encoding: p.encoding },
      });
    });
  },

  "file.stat": async ({ params, respond, context }) => {
    const p = params as { nodeId?: string; path?: string };
    const nodeId = typeof p.nodeId === "string" ? p.nodeId.trim() : "";
    const filePath = typeof p.path === "string" ? p.path.trim() : "";
    if (!filePath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path required"));
      return;
    }

    // Local gateway filesystem
    if (isLocal(nodeId)) {
      await respondUnavailableOnThrow(respond, async () => {
        const result = await handleFileStat({ path: filePath });
        respond(true, result, undefined);
      });
      return;
    }

    await respondUnavailableOnThrow(respond, async () => {
      await invokeFileCommand({
        context,
        respond,
        nodeId,
        command: "file.stat",
        commandParams: { path: filePath },
      });
    });
  },
};

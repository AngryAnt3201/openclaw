// ---------------------------------------------------------------------------
// Credential Agent Tool – allows agents to list, checkout, and request access
// to credentials managed by the Credential Manager.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const CREDENTIAL_ACTIONS = ["list", "checkout", "request_access"] as const;

const CredentialToolSchema = Type.Object({
  action: stringEnum(CREDENTIAL_ACTIONS, {
    description:
      "list: list all credentials with your access status. checkout: decrypt and retrieve a secret you have access to. request_access: create an approval task requesting access to a credential.",
  }),
  // checkout / request_access
  credentialId: Type.Optional(
    Type.String({ description: "The credential ID to checkout or request access to" }),
  ),
  // checkout
  taskId: Type.Optional(Type.String({ description: "Task ID for lease-based access (checkout)" })),
  toolName: Type.Optional(
    Type.String({ description: "Tool name for policy evaluation (checkout)" }),
  ),
  // request_access
  reason: Type.Optional(
    Type.String({ description: "Reason for requesting access (request_access)" }),
  ),
});

export function createCredentialTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  const agentId = resolveAgentIdFromSessionKey(opts?.agentSessionKey);

  return {
    label: "Credentials",
    name: "credential",
    description:
      "Manage credentials from the Credential Manager. List available credentials and your access status, checkout (decrypt) secrets you have access to, or request access to credentials you need.\n\nAccess is controlled by the operator — you may have permanent grants or temporary leases tied to tasks. If you don't have access, use request_access to ask the operator to grant it.",
    parameters: CredentialToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      const gatewayOpts = {};

      switch (action) {
        case "list": {
          const res = await callGatewayTool<{ credentials: Array<Record<string, unknown>> }>(
            "credential.list",
            gatewayOpts,
          );
          const credentials =
            (res as { credentials: Array<Record<string, unknown>> }).credentials ?? [];

          // Annotate each credential with agent's access status
          const annotated = credentials.map((cred) => {
            const grants = (cred.accessGrants as Array<{ agentId: string }>) ?? [];
            const leases =
              (cred.activeLeases as Array<{
                agentId: string;
                revokedAtMs?: number;
                expiresAtMs: number;
              }>) ?? [];

            const hasGrant = grants.some((g) => g.agentId === agentId);
            const activeLease = leases.find(
              (l) => l.agentId === agentId && !l.revokedAtMs && l.expiresAtMs > Date.now(),
            );

            let accessStatus: "has_grant" | "has_lease" | "no_access";
            if (hasGrant) {
              accessStatus = "has_grant";
            } else if (activeLease) {
              accessStatus = "has_lease";
            } else {
              accessStatus = "no_access";
            }

            return {
              id: cred.id,
              name: cred.name,
              category: cred.category,
              provider: cred.provider,
              description: cred.description,
              tags: cred.tags,
              enabled: cred.enabled,
              accessStatus,
              grantCount: grants.length,
              activeLeaseCount: leases.filter((l) => !l.revokedAtMs && l.expiresAtMs > Date.now())
                .length,
              usageCount: cred.usageCount ?? 0,
            };
          });

          return jsonResult({ credentials: annotated, agentId });
        }

        case "checkout": {
          const credentialId = readStringParam(params, "credentialId", { required: true });
          const taskId = readStringParam(params, "taskId");
          const toolName = readStringParam(params, "toolName");

          const payload: Record<string, unknown> = { credentialId, agentId };
          if (taskId) {
            payload.taskId = taskId;
          }
          if (toolName) {
            payload.toolName = toolName;
          }

          const result = await callGatewayTool("credential.checkout", gatewayOpts, payload);
          return jsonResult(result);
        }

        case "request_access": {
          const credentialId = readStringParam(params, "credentialId", { required: true });
          const reason = readStringParam(params, "reason");

          // Fetch credential name for a readable task title
          let credentialName = credentialId;
          try {
            const credRes = await callGatewayTool<{ name?: string }>(
              "credential.get",
              gatewayOpts,
              { credentialId },
            );
            if ((credRes as { name?: string })?.name) {
              credentialName = (credRes as { name: string }).name;
            }
          } catch {
            // Proceed with ID if we can't fetch the name
          }

          const description = [
            `Agent **${agentId}** is requesting access to credential **${credentialName}** (\`${credentialId}\`).`,
            reason ? `\nReason: ${reason}` : "",
            `\nTo grant access, go to Credential Manager → select "${credentialName}" → toggle access for agent "${agentId}".`,
          ].join("");

          const task = await callGatewayTool("task.create", gatewayOpts, {
            title: `Grant credential access: ${credentialName}`,
            description,
            type: "approval_gate",
            source: "agent",
            priority: "medium",
            metadata: {
              credentialId,
              agentId,
              reason: reason ?? undefined,
            },
          });

          return jsonResult({
            status: "pending",
            message: `Access request submitted. An approval task has been created for the operator.`,
            credentialId,
            agentId,
            task,
          });
        }

        default:
          throw new Error(`Unknown credential action: ${action}`);
      }
    },
  };
}

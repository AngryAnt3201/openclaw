// ---------------------------------------------------------------------------
// Gateway RPC handlers for inbound.* methods – follows notifications.ts pattern
// ---------------------------------------------------------------------------

import type {
  RawInboundMessage,
  InboundMessageFilter,
  InboundChannelCreateInput,
  InboundRouteCreateInput,
  InboundProcessingResult,
} from "../../inbound/types.js";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

function requireString(params: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = params[key];
    if (typeof val === "string" && val.trim()) {
      return val.trim();
    }
  }
  return null;
}

export const inboundHandlers: GatewayRequestHandlers = {
  // =========================================================================
  // Messages
  // =========================================================================

  // -------------------------------------------------------------------------
  // inbound.message.ingest
  // -------------------------------------------------------------------------
  "inbound.message.ingest": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const raw = params as unknown as RawInboundMessage;
    if (!raw.source || typeof raw.source !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing source"));
      return;
    }
    if (!raw.body || typeof raw.body !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing body"));
      return;
    }
    const message = await svc.ingestMessage(raw);
    respond(true, message, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.message.list
  // -------------------------------------------------------------------------
  "inbound.message.list": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const filter = (params ?? {}) as InboundMessageFilter;
    const messages = await svc.listMessages(filter);
    respond(true, { messages }, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.message.get
  // -------------------------------------------------------------------------
  "inbound.message.get": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const id = requireString(params, "messageId", "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing messageId"));
      return;
    }
    const message = await svc.getMessage(id);
    if (!message) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `message not found: ${id}`));
      return;
    }
    respond(true, message, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.message.markProcessed
  // -------------------------------------------------------------------------
  "inbound.message.markProcessed": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const id = requireString(params, "messageId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing messageId"));
      return;
    }
    const result = (params as any).result as InboundProcessingResult | undefined;
    const message = await svc.markProcessed(id, result);
    if (!message) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `message not found: ${id}`));
      return;
    }
    respond(true, message, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.message.delete
  // -------------------------------------------------------------------------
  "inbound.message.delete": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const id = requireString(params, "messageId");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing messageId"));
      return;
    }
    const deleted = await svc.deleteMessage(id);
    if (!deleted) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `message not found: ${id}`));
      return;
    }
    respond(true, { deleted: true }, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.message.linkTask
  // -------------------------------------------------------------------------
  "inbound.message.linkTask": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const messageId = requireString(params, "messageId");
    if (!messageId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing messageId"));
      return;
    }
    const taskId = requireString(params, "taskId");
    if (!taskId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing taskId"));
      return;
    }
    const message = await svc.linkToTask(messageId, taskId);
    if (!message) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `message not found: ${messageId}`),
      );
      return;
    }
    respond(true, message, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.message.unprocessedCount
  // -------------------------------------------------------------------------
  "inbound.message.unprocessedCount": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const count = await svc.getUnprocessedCount();
    respond(true, { count }, undefined);
  },

  // =========================================================================
  // Channels
  // =========================================================================

  // -------------------------------------------------------------------------
  // inbound.channel.list
  // -------------------------------------------------------------------------
  "inbound.channel.list": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const channels = await svc.listChannels();
    respond(true, { channels }, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.channel.add
  // -------------------------------------------------------------------------
  "inbound.channel.add": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const input = params as unknown as InboundChannelCreateInput;
    if (!input.type || typeof input.type !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing type"));
      return;
    }
    if (!input.name || typeof input.name !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    const channel = await svc.addChannel(input);
    const pm = (context as any).pollerManager;
    if (pm) {
      pm.handleChannelEvent("inbound.channel.added", channel);
    }
    respond(true, channel, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.channel.update
  // -------------------------------------------------------------------------
  "inbound.channel.update": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const id = requireString(params, "channelId", "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing channelId"));
      return;
    }
    const { channelId: _a, id: _b, ...patch } = params;
    const channel = await svc.updateChannel(id, patch);
    if (!channel) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `channel not found: ${id}`));
      return;
    }
    const pm = (context as any).pollerManager;
    if (pm) {
      pm.handleChannelEvent("inbound.channel.updated", channel);
    }
    respond(true, channel, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.channel.remove
  // -------------------------------------------------------------------------
  "inbound.channel.remove": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const id = requireString(params, "channelId", "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing channelId"));
      return;
    }
    const removed = await svc.removeChannel(id);
    if (!removed) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `channel not found: ${id}`));
      return;
    }
    const pm = (context as any).pollerManager;
    if (pm) {
      pm.handleChannelEvent("inbound.channel.removed", { id } as any);
    }
    respond(true, { removed: true }, undefined);
  },

  // =========================================================================
  // Routes
  // =========================================================================

  // -------------------------------------------------------------------------
  // inbound.route.list
  // -------------------------------------------------------------------------
  "inbound.route.list": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const routes = await svc.listRoutes();
    respond(true, { routes }, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.route.add
  // -------------------------------------------------------------------------
  "inbound.route.add": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const input = params as unknown as InboundRouteCreateInput;
    if (!input.name || typeof input.name !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }
    if (!input.filter || typeof input.filter !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing filter"));
      return;
    }
    if (!input.action || typeof input.action !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing action"));
      return;
    }
    const route = await svc.addRoute(input);
    respond(true, route, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.route.update
  // -------------------------------------------------------------------------
  "inbound.route.update": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const id = requireString(params, "routeId", "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing routeId"));
      return;
    }
    const { routeId: _a, id: _b, ...patch } = params;
    const route = await svc.updateRoute(id, patch);
    if (!route) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `route not found: ${id}`));
      return;
    }
    respond(true, route, undefined);
  },

  // -------------------------------------------------------------------------
  // inbound.route.remove
  // -------------------------------------------------------------------------
  "inbound.route.remove": async ({ params, respond, context }) => {
    const svc = (context as any).inboundService;
    if (!svc) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "inbound not enabled"));
      return;
    }
    const id = requireString(params, "routeId", "id");
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing routeId"));
      return;
    }
    const removed = await svc.removeRoute(id);
    if (!removed) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `route not found: ${id}`));
      return;
    }
    respond(true, { removed: true }, undefined);
  },
};

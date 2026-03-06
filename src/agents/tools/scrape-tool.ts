// ---------------------------------------------------------------------------
// Scrape Agent Tool – allows agents to fetch, extract, and manage browser
// sessions via the Scrapling sidecar
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool } from "./gateway.js";

const SCRAPE_ACTIONS = [
  "fetch",
  "extract",
  "login",
  "session_create",
  "session_list",
  "session_destroy",
] as const;

const ScrapeToolSchema = Type.Object({
  action: stringEnum(SCRAPE_ACTIONS),
  // fetch / extract / login
  url: Type.Optional(Type.String()),
  mode: Type.Optional(
    stringEnum(["httpx", "playwright", "camoufox"] as const, {
      description: "Fetcher tier: httpx (fast), playwright (JS render), camoufox (stealth)",
    }),
  ),
  session: Type.Optional(Type.String({ description: "Named browser session to reuse" })),
  proxy: Type.Optional(Type.String({ description: "Proxy URL (http/socks5)" })),
  headers: Type.Optional(Type.Any({ description: "Custom request headers object" })),
  timeout: Type.Optional(Type.Number({ description: "Request timeout in seconds" })),
  // extract-specific
  schema: Type.Optional(Type.Any({ description: "JSON schema describing fields to extract" })),
  selectors: Type.Optional(
    Type.Any({ description: "CSS/XPath selectors mapping field names to page elements" }),
  ),
  // login-specific
  steps: Type.Optional(
    Type.Array(Type.Any(), {
      description: "Login automation steps (click, fill, submit, wait)",
    }),
  ),
  // session_create
  name: Type.Optional(Type.String({ description: "Session name" })),
  ttl_minutes: Type.Optional(Type.Number({ description: "Session time-to-live in minutes" })),
});

export function createScrapeTool(_opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Scrape",
    name: "scrape",
    description:
      "Web scraping via Scrapling sidecar. Actions: fetch (get page content), extract (structured data extraction), login (automate authentication), session_create, session_list, session_destroy.",
    parameters: ScrapeToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = {};

      switch (action) {
        case "fetch": {
          const url = readStringParam(params, "url", { required: true });
          const payload: Record<string, unknown> = { url };
          if (params.mode) {
            payload.mode = params.mode;
          }
          if (params.session) {
            payload.session = params.session;
          }
          if (params.proxy) {
            payload.proxy = params.proxy;
          }
          if (params.headers !== undefined) {
            payload.headers = params.headers;
          }
          if (params.timeout !== undefined) {
            payload.timeout = params.timeout;
          }
          const result = await callGatewayTool("scrape.fetch", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "extract": {
          const url = readStringParam(params, "url", { required: true });
          const payload: Record<string, unknown> = { url };
          if (params.schema !== undefined) {
            payload.schema = params.schema;
          }
          if (params.selectors !== undefined) {
            payload.selectors = params.selectors;
          }
          if (params.mode) {
            payload.mode = params.mode;
          }
          if (params.session) {
            payload.session = params.session;
          }
          if (params.proxy) {
            payload.proxy = params.proxy;
          }
          if (params.timeout !== undefined) {
            payload.timeout = params.timeout;
          }
          const result = await callGatewayTool("scrape.extract", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "login": {
          const url = readStringParam(params, "url", { required: true });
          const payload: Record<string, unknown> = { url };
          if (params.session) {
            payload.session = params.session;
          }
          if (params.steps !== undefined) {
            payload.steps = params.steps;
          }
          if (params.proxy) {
            payload.proxy = params.proxy;
          }
          if (params.timeout !== undefined) {
            payload.timeout = params.timeout;
          }
          const result = await callGatewayTool("scrape.login", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "session_create": {
          const name = readStringParam(params, "name", { required: true });
          const payload: Record<string, unknown> = { name };
          if (params.ttl_minutes !== undefined) {
            payload.ttl_minutes = params.ttl_minutes;
          }
          if (params.proxy) {
            payload.proxy = params.proxy;
          }
          const result = await callGatewayTool("scrape.session.create", gatewayOpts, payload);
          return jsonResult(result);
        }
        case "session_list": {
          const result = await callGatewayTool("scrape.session.list", gatewayOpts, {});
          return jsonResult(result);
        }
        case "session_destroy": {
          const name = readStringParam(params, "name", { required: true });
          const result = await callGatewayTool("scrape.session.destroy", gatewayOpts, { name });
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown scrape action: ${action}`);
      }
    },
  };
}

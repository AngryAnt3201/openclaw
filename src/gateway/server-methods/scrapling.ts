// ---------------------------------------------------------------------------
// Gateway RPC handlers for scrape.* methods – proxies to Scrapling sidecar
// ---------------------------------------------------------------------------

import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { loadConfig } from "../../config/config.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ScraplingConfig = {
  enabled?: boolean;
  baseUrl?: string;
  timeoutSeconds?: number;
};

function resolveScraplingConfig(): ScraplingConfig | null {
  const cfg = loadConfig();
  const sc = cfg.tools?.web?.scrapling;
  if (!sc?.enabled) {
    return null;
  }
  return sc;
}

/**
 * Proxy an HTTP request to the Scrapling sidecar and return the JSON body.
 * On network / HTTP errors, calls `respond()` with a structured error and
 * returns `null` so the caller knows to bail out.
 */
async function proxyToScrapling(
  opts: {
    method: "GET" | "POST" | "DELETE";
    path: string;
    body?: unknown;
    timeoutMs?: number;
  },
  baseUrl: string,
  respond: RespondFn,
): Promise<unknown | null> {
  const url = `${baseUrl.replace(/\/+$/, "")}${opts.path}`;
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const fetchOpts: RequestInit = {
      method: opts.method,
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    };
    if (opts.body !== undefined) {
      fetchOpts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, fetchOpts);

    if (!res.ok) {
      let detail: unknown;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text().catch(() => undefined);
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `scrapling sidecar returned ${res.status}`, {
          details: detail,
        }),
      );
      return null;
    }

    // DELETE may return 204 with no body
    if (res.status === 204) {
      return {};
    }
    return await res.json();
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `scrapling sidecar request timed out after ${timeout}ms`
        : `scrapling sidecar unreachable: ${err instanceof Error ? err.message : String(err)}`;
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validates scrapling is enabled and returns { baseUrl, timeoutMs }.
 * Calls `respond()` with an error if disabled and returns `null`.
 */
function requireScrapling(respond: RespondFn): { baseUrl: string; timeoutMs: number } | null {
  const sc = resolveScraplingConfig();
  if (!sc) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "scrapling sidecar is not enabled"),
    );
    return null;
  }
  return {
    baseUrl: sc.baseUrl ?? "http://localhost:18790",
    timeoutMs: (sc.timeoutSeconds ?? 30) * 1000,
  };
}

function requireString(params: Record<string, unknown>, key: string): string | null {
  const val = params[key];
  if (typeof val === "string" && val.trim()) {
    return val.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const scraplingHandlers: GatewayRequestHandlers = {
  // -------------------------------------------------------------------------
  // scrape.health — GET /health
  // -------------------------------------------------------------------------
  "scrape.health": async ({ respond }) => {
    const env = requireScrapling(respond);
    if (!env) {
      return;
    }

    const data = await proxyToScrapling(
      { method: "GET", path: "/health", timeoutMs: env.timeoutMs },
      env.baseUrl,
      respond,
    );
    if (data === null) {
      return;
    }
    respond(true, data, undefined);
  },

  // -------------------------------------------------------------------------
  // scrape.fetch — POST /fetch
  // -------------------------------------------------------------------------
  "scrape.fetch": async ({ params, respond }) => {
    const env = requireScrapling(respond);
    if (!env) {
      return;
    }

    const url = requireString(params, "url");
    if (!url) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing url"));
      return;
    }

    const body: Record<string, unknown> = { url };
    if (params.mode) {
      body.mode = params.mode;
    }
    if (params.session) {
      body.session = params.session;
    }
    if (params.proxy) {
      body.proxy = params.proxy;
    }
    if (params.headers) {
      body.headers = params.headers;
    }
    if (params.timeout !== undefined) {
      body.timeout = params.timeout;
    }

    const data = await proxyToScrapling(
      { method: "POST", path: "/fetch", body, timeoutMs: env.timeoutMs },
      env.baseUrl,
      respond,
    );
    if (data === null) {
      return;
    }
    respond(true, data, undefined);
  },

  // -------------------------------------------------------------------------
  // scrape.extract — POST /extract
  // -------------------------------------------------------------------------
  "scrape.extract": async ({ params, respond }) => {
    const env = requireScrapling(respond);
    if (!env) {
      return;
    }

    const url = requireString(params, "url");
    if (!url) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing url"));
      return;
    }

    const body: Record<string, unknown> = { url };
    if (params.schema) {
      body.schema = params.schema;
    }
    if (params.selectors) {
      body.selectors = params.selectors;
    }
    if (params.mode) {
      body.mode = params.mode;
    }
    if (params.session) {
      body.session = params.session;
    }
    if (params.proxy) {
      body.proxy = params.proxy;
    }
    if (params.timeout !== undefined) {
      body.timeout = params.timeout;
    }

    const data = await proxyToScrapling(
      { method: "POST", path: "/extract", body, timeoutMs: env.timeoutMs },
      env.baseUrl,
      respond,
    );
    if (data === null) {
      return;
    }
    respond(true, data, undefined);
  },

  // -------------------------------------------------------------------------
  // scrape.login — POST /login
  // -------------------------------------------------------------------------
  "scrape.login": async ({ params, respond }) => {
    const env = requireScrapling(respond);
    if (!env) {
      return;
    }

    const url = requireString(params, "url");
    if (!url) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing url"));
      return;
    }

    const body: Record<string, unknown> = { url };
    if (params.session) {
      body.session = params.session;
    }
    if (params.steps) {
      body.steps = params.steps;
    }
    if (params.proxy) {
      body.proxy = params.proxy;
    }
    if (params.timeout !== undefined) {
      body.timeout = params.timeout;
    }

    const data = await proxyToScrapling(
      { method: "POST", path: "/login", body, timeoutMs: env.timeoutMs },
      env.baseUrl,
      respond,
    );
    if (data === null) {
      return;
    }
    respond(true, data, undefined);
  },

  // -------------------------------------------------------------------------
  // scrape.session.create — POST /sessions
  // -------------------------------------------------------------------------
  "scrape.session.create": async ({ params, respond }) => {
    const env = requireScrapling(respond);
    if (!env) {
      return;
    }

    const name = requireString(params, "name");
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }

    const body: Record<string, unknown> = { name };
    if (params.ttl_minutes !== undefined) {
      body.ttl_minutes = params.ttl_minutes;
    }
    if (params.proxy) {
      body.proxy = params.proxy;
    }

    const data = await proxyToScrapling(
      { method: "POST", path: "/sessions", body, timeoutMs: env.timeoutMs },
      env.baseUrl,
      respond,
    );
    if (data === null) {
      return;
    }
    respond(true, data, undefined);
  },

  // -------------------------------------------------------------------------
  // scrape.session.list — GET /sessions
  // -------------------------------------------------------------------------
  "scrape.session.list": async ({ respond }) => {
    const env = requireScrapling(respond);
    if (!env) {
      return;
    }

    const data = await proxyToScrapling(
      { method: "GET", path: "/sessions", timeoutMs: env.timeoutMs },
      env.baseUrl,
      respond,
    );
    if (data === null) {
      return;
    }
    respond(true, data, undefined);
  },

  // -------------------------------------------------------------------------
  // scrape.session.get — GET /sessions/{name}
  // -------------------------------------------------------------------------
  "scrape.session.get": async ({ params, respond }) => {
    const env = requireScrapling(respond);
    if (!env) {
      return;
    }

    const name = requireString(params, "name");
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }

    const data = await proxyToScrapling(
      { method: "GET", path: `/sessions/${encodeURIComponent(name)}`, timeoutMs: env.timeoutMs },
      env.baseUrl,
      respond,
    );
    if (data === null) {
      return;
    }
    respond(true, data, undefined);
  },

  // -------------------------------------------------------------------------
  // scrape.session.destroy — DELETE /sessions/{name}
  // -------------------------------------------------------------------------
  "scrape.session.destroy": async ({ params, respond }) => {
    const env = requireScrapling(respond);
    if (!env) {
      return;
    }

    const name = requireString(params, "name");
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing name"));
      return;
    }

    const data = await proxyToScrapling(
      {
        method: "DELETE",
        path: `/sessions/${encodeURIComponent(name)}`,
        timeoutMs: env.timeoutMs,
      },
      env.baseUrl,
      respond,
    );
    if (data === null) {
      return;
    }
    respond(true, data, undefined);
  },
};

// ---------------------------------------------------------------------------
// ClawHub RPC handlers – search via HTTP API, install via CLI
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GatewayRequestHandlers } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";

const exec = promisify(execFile);

const CLAWHUB_API = "https://clawhub.ai/api/search";
const SEARCH_TIMEOUT_MS = 10_000;
const DEFAULT_CLI_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// CLI helper (used by clawhub.install)
// ---------------------------------------------------------------------------

async function clawhubCli(args: string[], opts?: { timeoutMs?: number }): Promise<string> {
  const { stdout } = await exec("clawhub", args, {
    env: process.env,
    timeout: opts?.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS,
    maxBuffer: 5 * 1024 * 1024,
  });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const clawhubHandlers: GatewayRequestHandlers = {
  "clawhub.search": async ({ params, respond }) => {
    const query = typeof params?.query === "string" ? params.query.trim() : "";
    if (!query) {
      respond(true, { skills: [] }, undefined);
      return;
    }
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), SEARCH_TIMEOUT_MS);
      const url = `${CLAWHUB_API}?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(timer);

      if (!res.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, `ClawHub API returned ${res.status}`),
        );
        return;
      }

      const body = (await res.json()) as {
        results?: {
          slug: string;
          displayName: string;
          summary?: string;
          version?: string;
          score?: number;
          updatedAt?: number;
        }[];
      };

      const skills = (body.results ?? []).map((r) => ({
        slug: r.slug,
        name: r.displayName ?? r.slug,
        description: r.summary || undefined,
        version: r.version || undefined,
      }));

      respond(true, { skills }, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `ClawHub search failed: ${message}`),
      );
    }
  },

  "clawhub.inspect": async ({ params, respond }) => {
    const slug = typeof params?.slug === "string" ? params.slug.trim() : "";
    if (!slug) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing required param: slug"),
      );
      return;
    }
    try {
      const raw = await clawhubCli(
        ["inspect", slug, "--json", "--files", "--file", "SKILL.md", "--no-input"],
        { timeoutMs: 15_000 },
      );
      const detail = JSON.parse(raw);
      respond(true, { detail }, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ENOENT") || message.includes("not found")) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "clawhub CLI not installed. Run: npm i -g clawhub"),
        );
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `clawhub inspect failed: ${message}`),
      );
    }
  },

  "clawhub.install": async ({ params, respond }) => {
    const slug = typeof params?.slug === "string" ? params.slug.trim() : "";
    if (!slug) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "missing required param: slug"),
      );
      return;
    }
    const version = typeof params?.version === "string" ? params.version.trim() : "";
    try {
      const args = ["install", slug];
      if (version) {
        args.push("--version", version);
      }
      const output = await clawhubCli(args, { timeoutMs: 30_000 });
      respond(true, { ok: true, slug, output }, undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("ENOENT") || message.includes("not found")) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "clawhub CLI not installed. Run: npm i -g clawhub"),
        );
        return;
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `clawhub install failed: ${message}`),
      );
    }
  },
};

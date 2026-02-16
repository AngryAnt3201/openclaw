/**
 * HTTP client for the Maestro REST API.
 *
 * Reads ~/.maestro/api-token and ~/.maestro/api-port to discover
 * the running Maestro instance and authenticate requests.
 */

import fs from "node:fs";
import path from "node:path";

const MAESTRO_DIR = path.join(process.env.HOME ?? "", ".maestro");
const TOKEN_PATH = path.join(MAESTRO_DIR, "api-token");
const PORT_PATH = path.join(MAESTRO_DIR, "api-port");

function readDiscovery(): { token: string; port: number } | null {
  try {
    const token = fs.readFileSync(TOKEN_PATH, "utf-8").trim();
    const port = Number.parseInt(fs.readFileSync(PORT_PATH, "utf-8").trim(), 10);
    if (!token || Number.isNaN(port)) {
      return null;
    }
    return { token, port };
  } catch {
    return null;
  }
}

export type MaestroSession = {
  session_id: number;
  status: string;
  worktree_path?: string;
  working_directory: string;
};

export type MaestroSessionDetail = {
  id: number;
  status: string;
  mode: string;
  branch?: string;
  worktree_path?: string;
  project_path: string;
};

export type MaestroHealthResponse = {
  status: string;
  instance_id: string;
  port: number;
  version: string;
};

export class MaestroClient {
  private token: string;
  private baseUrl: string;

  constructor() {
    const discovery = readDiscovery();
    if (!discovery) {
      throw new Error(
        "Maestro is not running or discovery files not found (~/.maestro/api-token, ~/.maestro/api-port)",
      );
    }
    this.token = discovery.token;
    this.baseUrl = `http://127.0.0.1:${discovery.port}/api/v1`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Maestro API error (${res.status}): ${text}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  async health(): Promise<MaestroHealthResponse> {
    return this.request("GET", "/health");
  }

  async createSession(params: {
    projectPath: string;
    branch?: string;
    mode?: string;
    initialPrompt?: string;
    autoPush?: boolean;
    env?: Record<string, string>;
    skipPermissions?: boolean;
    customFlags?: string;
  }): Promise<MaestroSession> {
    return this.request("POST", "/sessions", {
      project_path: params.projectPath,
      branch: params.branch,
      mode: params.mode ?? "claude",
      initial_prompt: params.initialPrompt,
      auto_push: params.autoPush ?? false,
      env: params.env,
      skip_permissions: params.skipPermissions,
      custom_flags: params.customFlags,
    });
  }

  async listSessions(): Promise<MaestroSessionDetail[]> {
    return this.request("GET", "/sessions");
  }

  async getSession(id: number): Promise<MaestroSessionDetail> {
    return this.request("GET", `/sessions/${id}`);
  }

  async sendInput(id: number, text: string): Promise<void> {
    await this.request("POST", `/sessions/${id}/input`, { text });
  }

  async getOutput(id: number, cursor?: number): Promise<{ output: string; cursor: number }> {
    const qs = cursor != null ? `?cursor=${cursor}` : "";
    return this.request("GET", `/sessions/${id}/output${qs}`);
  }

  async killSession(id: number): Promise<void> {
    await this.request("DELETE", `/sessions/${id}`);
  }
}

/** Create a client, returning null if Maestro is not available. */
export function tryCreateMaestroClient(): MaestroClient | null {
  try {
    return new MaestroClient();
  } catch {
    return null;
  }
}

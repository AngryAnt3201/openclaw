/**
 * Cloudflare Tunnel Manager for OpenClaw.
 *
 * Manages a `cloudflared tunnel` child process that creates a public URL
 * pointing to the local OpenClaw gateway. Used to receive GitHub webhooks
 * and other external callbacks.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

export interface TunnelConfig {
  enabled: boolean;
  provider?: "cloudflare";
  targetPort: number;
}

export interface TunnelStatus {
  running: boolean;
  url: string | null;
  error: string | null;
}

export class TunnelManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private _url: string | null = null;
  private _error: string | null = null;
  private _running = false;

  get url(): string | null {
    return this._url;
  }

  get status(): TunnelStatus {
    return {
      running: this._running,
      url: this._url,
      error: this._error,
    };
  }

  /**
   * Start the cloudflared tunnel process.
   * Parses stdout/stderr for the assigned public URL.
   */
  async start(config: TunnelConfig): Promise<TunnelStatus> {
    if (this._running) {
      return this.status;
    }

    if (!config.enabled) {
      return { running: false, url: null, error: null };
    }

    const targetUrl = `http://localhost:${config.targetPort}`;

    return new Promise((resolve) => {
      try {
        this.process = spawn("cloudflared", ["tunnel", "--url", targetUrl], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        this._running = true;
        this._error = null;

        let resolved = false;
        const resolveOnce = () => {
          if (!resolved) {
            resolved = true;
            resolve(this.status);
          }
        };

        // Parse output for the tunnel URL
        const handleOutput = (data: Buffer) => {
          const text = data.toString();
          // cloudflared outputs the URL in a line like:
          // | https://xxxx-xxxx-xxxx.trycloudflare.com |
          // or: INF |  https://xxxx.trycloudflare.com
          const urlMatch = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
          if (urlMatch && !this._url) {
            this._url = urlMatch[0];
            this.emit("url", this._url);
            resolveOnce();
          }
        };

        this.process.stdout?.on("data", handleOutput);
        this.process.stderr?.on("data", handleOutput);

        this.process.on("error", (err) => {
          this._error = err.message;
          this._running = false;
          this.emit("error", err.message);
          resolveOnce();
        });

        this.process.on("close", (code) => {
          this._running = false;
          if (code !== 0 && !this._url) {
            this._error = `cloudflared exited with code ${code}`;
          }
          this.emit("close", code);
          resolveOnce();
        });

        // Timeout: if URL not found within 15 seconds, resolve anyway
        setTimeout(() => {
          if (!this._url) {
            this._error = "Tunnel URL not detected within timeout";
          }
          resolveOnce();
        }, 15000);
      } catch (err) {
        this._error = `Failed to start cloudflared: ${err instanceof Error ? err.message : String(err)}`;
        this._running = false;
        resolve(this.status);
      }
    });
  }

  /** Stop the tunnel process. */
  stop(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this._running = false;
    this._url = null;
    this._error = null;
    this.emit("close", 0);
  }
}

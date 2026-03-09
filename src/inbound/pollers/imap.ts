// ---------------------------------------------------------------------------
// Gmail IMAP Poller – IDLE-based near-real-time email ingestion
// ---------------------------------------------------------------------------

import { ImapFlow } from "imapflow";
import type { Poller, PollerConfig, PollerStatus, PollerLog } from "./types.js";
import { normalizeEmailMessage, forwardToInbound } from "../bridge.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ImapPollerConfig extends PollerConfig {
  imapHost: string;
  imapUser: string;
  imapPass: string;
  imapPort?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECONNECT_DELAY_MS = 30_000;
const POLL_INTERVAL_MS = 60_000;
const MAX_BODY_CHARS = 10_000;
const DEFAULT_PORT = 993;

// ---------------------------------------------------------------------------
// ImapPoller
// ---------------------------------------------------------------------------

export class ImapPoller implements Poller {
  readonly channelId: string;

  private config: ImapPollerConfig;
  private log: PollerLog;
  private client: ImapFlow | null = null;
  private _status: PollerStatus = "idle";
  private running = false;
  private lastSeenUid = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private idleSupported = true;

  constructor(config: ImapPollerConfig, log?: PollerLog) {
    this.channelId = config.channelId;
    this.config = config;
    this.log = log ?? {
      info: (msg: string) => console.log(`[imap:${config.channelId}] ${msg}`),
      warn: (msg: string) => console.warn(`[imap:${config.channelId}] ${msg}`),
      error: (msg: string) => console.error(`[imap:${config.channelId}] ${msg}`),
    };
  }

  // ---- Lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.setStatus("connecting");
    await this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearTimers();

    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // ignore — connection may already be dead
      }
      this.client = null;
    }

    this.setStatus("disconnected");
  }

  status(): PollerStatus {
    return this._status;
  }

  // ---- Connection ---------------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.clearTimers();

    try {
      this.client = new ImapFlow({
        host: this.config.imapHost,
        port: this.config.imapPort ?? DEFAULT_PORT,
        secure: true,
        auth: {
          user: this.config.imapUser,
          pass: this.config.imapPass,
        },
        logger: false as unknown as undefined,
      });

      // Handle unexpected close
      this.client.on("close", () => {
        if (!this.running) {
          return;
        }
        this.log.warn("connection closed unexpectedly");
        this.setStatus("disconnected");
        this.scheduleReconnect();
      });

      this.client.on("error", (err: Error) => {
        this.log.error(`connection error: ${err.message}`);
      });

      await this.client.connect();
      this.setStatus("connected");
      this.log.info(`connected to ${this.config.imapHost}`);

      // Start the main loop
      void this.runLoop();
    } catch (err) {
      this.log.error(`connect failed: ${String(err)}`);
      this.setStatus("error");
      this.scheduleReconnect();
    }
  }

  // ---- Main loop ----------------------------------------------------------

  private async runLoop(): Promise<void> {
    if (!this.running || !this.client) {
      return;
    }

    try {
      // Lock INBOX for operations
      const lock = await this.client.getMailboxLock("INBOX");

      try {
        // Initial sync — fetch any existing new messages
        await this.fetchNewMessages();

        // Enter IDLE/poll loop
        while (this.running && this.client) {
          if (this.idleSupported) {
            await this.idleWait();
          } else {
            await this.pollWait();
          }

          if (!this.running || !this.client) {
            break;
          }

          this.setStatus("syncing");
          await this.fetchNewMessages();
          this.setStatus("connected");
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      if (!this.running) {
        return;
      }
      this.log.error(`loop error: ${String(err)}`);
      this.setStatus("error");
      this.scheduleReconnect();
    }
  }

  // ---- IDLE wait ----------------------------------------------------------

  private async idleWait(): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      await this.client.idle();
    } catch (err) {
      if (!this.running) {
        return;
      }

      const msg = String(err);
      // If IDLE is not supported, fall back to polling
      if (msg.includes("IDLE") || msg.includes("idle")) {
        this.log.warn("IDLE not supported, falling back to polling");
        this.idleSupported = false;
      } else {
        throw err;
      }
    }
  }

  // ---- Poll fallback ------------------------------------------------------

  private pollWait(): Promise<void> {
    return new Promise((resolve) => {
      this.pollTimer = setTimeout(() => {
        this.pollTimer = null;
        resolve();
      }, POLL_INTERVAL_MS);
    });
  }

  // ---- Fetch new messages -------------------------------------------------

  private async fetchNewMessages(): Promise<void> {
    if (!this.client) {
      return;
    }

    // Search for messages with UID > lastSeenUid
    const searchCriteria =
      this.lastSeenUid > 0 ? { uid: `${this.lastSeenUid + 1}:*` } : { seen: false };

    let count = 0;

    try {
      for await (const msg of this.client.fetch(searchCriteria, {
        uid: true,
        envelope: true,
        source: true,
        bodyStructure: true,
      })) {
        // Skip the boundary UID (IMAP returns lastSeenUid when using uid:*)
        if (msg.uid <= this.lastSeenUid) {
          continue;
        }

        this.lastSeenUid = msg.uid;
        count++;

        try {
          this.processMessage(msg);
        } catch (err) {
          this.log.warn(`failed to process message uid=${msg.uid}: ${String(err)}`);
        }
      }
    } catch (err) {
      // Fetch can fail if no messages match — that's fine
      const errStr = String(err);
      if (!errStr.includes("Nothing to fetch") && !errStr.includes("UID FETCH")) {
        throw err;
      }
    }

    if (count > 0) {
      this.log.info(`processed ${count} new message(s), lastUid=${this.lastSeenUid}`);
    }
  }

  // ---- Message processing -------------------------------------------------

  private processMessage(msg: {
    uid: number;
    envelope?: {
      messageId?: string;
      subject?: string;
      from?: Array<{ name?: string; address?: string }>;
      to?: Array<{ name?: string; address?: string }>;
      date?: Date;
    };
    source?: Buffer;
    bodyStructure?: {
      type?: string;
      childNodes?: Array<{
        type?: string;
        disposition?: string;
        dispositionParameters?: { filename?: string };
        size?: number;
      }>;
    };
  }): void {
    const envelope = msg.envelope ?? {};

    // Extract message ID
    const messageId = envelope.messageId ?? `uid:${msg.uid}`;

    // Extract sender info
    const fromAddr = envelope.from?.[0]?.address ?? "unknown";
    const fromName = envelope.from?.[0]?.name;

    // Extract recipient
    const toAddr = envelope.to?.[0]?.address;

    // Extract subject
    const subject = envelope.subject ?? "(no subject)";

    // Extract body from raw source
    let body = "";
    if (msg.source) {
      body = this.extractTextBody(msg.source);
    }

    // Cap body length
    if (body.length > MAX_BODY_CHARS) {
      body = body.slice(0, MAX_BODY_CHARS) + "\n\n[truncated]";
    }

    // If body is empty, use subject as body
    if (!body.trim()) {
      body = subject;
    }

    // Collect attachment info from bodyStructure
    const attachments: Array<{ filename: string; contentType?: string; size?: number }> = [];

    if (msg.bodyStructure?.childNodes) {
      for (const node of msg.bodyStructure.childNodes) {
        if (node.disposition === "attachment" || node.disposition === "inline") {
          attachments.push({
            filename: node.dispositionParameters?.filename ?? `attachment-${attachments.length}`,
            contentType: node.type,
            size: node.size,
          });
        }
      }
    }

    // Normalize and forward
    const raw = normalizeEmailMessage({
      messageId,
      subject,
      body,
      from: fromAddr,
      fromName,
      to: toAddr,
      date: envelope.date,
      channelId: this.channelId,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    forwardToInbound(raw);
  }

  // ---- Body extraction ----------------------------------------------------

  /**
   * Extract plain text body from raw email source.
   * Looks for text after the header/body separator (double CRLF).
   * For multipart messages, attempts to find the text/plain part.
   */
  private extractTextBody(source: Buffer): string {
    const raw = source.toString("utf-8");

    // Split header from body at double CRLF
    const sepIdx = raw.indexOf("\r\n\r\n");
    if (sepIdx === -1) {
      return "";
    }

    const bodyPart = raw.slice(sepIdx + 4);

    // Check if multipart — look for boundary in headers
    const headerPart = raw.slice(0, sepIdx);
    const boundaryMatch = headerPart.match(/boundary="?([^"\r\n;]+)"?/i);

    if (boundaryMatch) {
      // Multipart — find the text/plain section
      const boundary = boundaryMatch[1];
      const parts = bodyPart.split(`--${boundary}`);

      for (const part of parts) {
        // Check for text/plain content type
        if (/content-type:\s*text\/plain/i.test(part)) {
          // Find body after the part's headers
          const partBodyIdx = part.indexOf("\r\n\r\n");
          if (partBodyIdx !== -1) {
            return part.slice(partBodyIdx + 4).trim();
          }
        }
      }

      // Fallback: try the first part that looks like text
      for (const part of parts) {
        const partBodyIdx = part.indexOf("\r\n\r\n");
        if (partBodyIdx !== -1) {
          const text = part.slice(partBodyIdx + 4).trim();
          if (text && !text.startsWith("<")) {
            return text;
          }
        }
      }
    }

    // Simple (non-multipart) — return entire body
    return bodyPart.trim();
  }

  // ---- Reconnection -------------------------------------------------------

  private scheduleReconnect(): void {
    if (!this.running) {
      return;
    }
    this.clearTimers();

    this.log.info(`reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, RECONNECT_DELAY_MS);
  }

  // ---- Helpers ------------------------------------------------------------

  private setStatus(s: PollerStatus): void {
    this._status = s;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

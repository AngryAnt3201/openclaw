// ---------------------------------------------------------------------------
// WhatsApp Baileys Poller — connects via @whiskeysockets/baileys (v7-rc)
// ---------------------------------------------------------------------------
// Uses QR code authentication with persistent multi-file auth state stored
// at ~/.openclaw/whatsapp-auth/{channelId}/. Listens for incoming messages
// and forwards them to the inbound system via forwardToInbound().
// ---------------------------------------------------------------------------

import { Boom } from "@hapi/boom";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  Poller,
  PollerConfig,
  PollerStatus,
  PollerStatusCallback,
  PollerLog,
} from "./types.js";
import { normalizeWhatsAppMessage, forwardToInbound } from "../bridge.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface WhatsAppPollerConfig extends PollerConfig {
  /** Optional callback invoked with QR string for frontend display */
  onQr?: (qr: string) => void;
  /** Optional status callback */
  onStatus?: PollerStatusCallback;
  /** Logger override */
  log?: PollerLog;
  /** Auth directory override (default: ~/.openclaw/whatsapp-auth/{channelId}) */
  authDir?: string;
  /** Browser identification sent to WhatsApp */
  browser?: [string, string, string];
}

// ---------------------------------------------------------------------------
// Default auth path
// ---------------------------------------------------------------------------

function defaultAuthDir(channelId: string): string {
  return path.join(os.homedir(), ".openclaw", "whatsapp-auth", channelId);
}

// ---------------------------------------------------------------------------
// Noop logger
// ---------------------------------------------------------------------------

const noop = () => {};
const NOOP_LOG: PollerLog = { info: noop, warn: noop, error: noop };

// ---------------------------------------------------------------------------
// WhatsAppPoller
// ---------------------------------------------------------------------------

export class WhatsAppPoller implements Poller {
  readonly channelId: string;

  private readonly config: WhatsAppPollerConfig;
  private readonly log: PollerLog;
  private readonly authDir: string;

  private sock: WASocket | null = null;
  private _status: PollerStatus = "idle";
  private stopping = false;

  constructor(config: WhatsAppPollerConfig) {
    this.channelId = config.channelId;
    this.config = config;
    this.log = config.log ?? NOOP_LOG;
    this.authDir = config.authDir ?? defaultAuthDir(config.channelId);
  }

  // -----------------------------------------------------------------------
  // Poller interface
  // -----------------------------------------------------------------------

  status(): PollerStatus {
    return this._status;
  }

  async start(): Promise<void> {
    if (this._status === "connected" || this._status === "connecting") {
      return;
    }
    this.stopping = false;
    this.setStatus("connecting");

    // Ensure auth directory exists
    await fs.mkdir(this.authDir, { recursive: true });

    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.setStatus("disconnected");
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private setStatus(s: PollerStatus, error?: string): void {
    this._status = s;
    this.config.onStatus?.(this.channelId, s, error);
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      browser: this.config.browser ?? ["Miranda", "Desktop", "1.0.0"],
      // Suppress Baileys internal logging noise
      logger: {
        level: "silent" as any,
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
        trace: noop,
        fatal: noop,
        child: () =>
          ({
            level: "silent" as any,
            info: noop,
            warn: noop,
            error: noop,
            debug: noop,
            trace: noop,
            fatal: noop,
            child: function self(): any {
              return self();
            } as any,
          }) as any,
      } as any,
    });

    this.sock = sock;

    // Persist credentials on update
    sock.ev.on("creds.update", saveCreds);

    // Connection lifecycle
    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Emit QR code for frontend pairing
      if (qr) {
        this.log.info(`[whatsapp:${this.channelId}] QR code received`);
        this.config.onQr?.(qr);
      }

      if (connection === "open") {
        this.log.info(`[whatsapp:${this.channelId}] connected`);
        this.setStatus("connected");
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (this.stopping) {
          // Intentional disconnect — don't reconnect
          return;
        }

        if (loggedOut) {
          this.log.warn(`[whatsapp:${this.channelId}] logged out — will not reconnect`);
          this.setStatus("error", "Logged out from WhatsApp. Re-scan QR code.");
          this.sock = null;
          return;
        }

        // Auto-reconnect for transient failures
        this.log.warn(
          `[whatsapp:${this.channelId}] disconnected (code ${statusCode}), reconnecting...`,
        );
        this.setStatus("connecting");

        // Small delay before reconnect to avoid tight loops
        setTimeout(() => {
          if (!this.stopping) {
            void this.connect().catch((err) => {
              this.log.error(`[whatsapp:${this.channelId}] reconnect failed: ${String(err)}`);
              this.setStatus("error", String(err));
            });
          }
        }, 3000);
      }
    });

    // Incoming messages
    sock.ev.on("messages.upsert", (upsert) => {
      // Only process new/notify messages, not history sync
      if (upsert.type !== "notify") {
        return;
      }

      for (const msg of upsert.messages) {
        try {
          this.handleMessage(msg);
        } catch (err) {
          this.log.error(`[whatsapp:${this.channelId}] error handling message: ${String(err)}`);
        }
      }
    });
  }

  private handleMessage(msg: any): void {
    // Skip own messages
    if (msg.key?.fromMe) {
      return;
    }

    // Skip protocol/status messages
    if (!msg.message) {
      return;
    }
    if (msg.key?.remoteJid === "status@broadcast") {
      return;
    }

    const remoteJid: string = msg.key?.remoteJid ?? "";
    const isGroup = remoteJid.endsWith("@g.us");

    // Extract text body from various message types
    const body = this.extractBody(msg.message);
    if (!body) {
      return;
    } // No text content — skip (e.g., stickers, reactions)

    // Determine sender
    const senderJid = isGroup ? (msg.key?.participant ?? remoteJid) : remoteJid;
    const senderName = msg.pushName ?? senderJid.split("@")[0];

    const messageId = msg.key?.id ?? `${remoteJid}:${msg.messageTimestamp ?? Date.now()}`;

    const raw = normalizeWhatsAppMessage({
      messageId,
      body,
      remoteJid,
      senderJid,
      senderName,
      channelId: this.channelId,
      isGroup,
      timestamp:
        typeof msg.messageTimestamp === "number"
          ? msg.messageTimestamp
          : typeof msg.messageTimestamp === "object" && msg.messageTimestamp?.low
            ? msg.messageTimestamp.low
            : undefined,
    });

    this.log.info(
      `[whatsapp:${this.channelId}] message from ${senderName} (${isGroup ? "group" : "DM"})`,
    );

    forwardToInbound(raw);
  }

  /**
   * Extract text body from the various WhatsApp message wrapper types.
   */
  private extractBody(message: any): string | undefined {
    if (!message) {
      return undefined;
    }

    // Plain text conversation
    if (message.conversation) {
      return message.conversation;
    }

    // Extended text (replies, links, etc.)
    if (message.extendedTextMessage?.text) {
      return message.extendedTextMessage.text;
    }

    // Media captions
    if (message.imageMessage?.caption) {
      return message.imageMessage.caption;
    }
    if (message.videoMessage?.caption) {
      return message.videoMessage.caption;
    }

    // Document with filename or caption
    if (message.documentMessage) {
      return message.documentMessage.caption ?? message.documentMessage.fileName ?? undefined;
    }

    // Document with caption sent as documentWithCaptionMessage
    if (message.documentWithCaptionMessage?.message?.documentMessage?.caption) {
      return message.documentWithCaptionMessage.message.documentMessage.caption;
    }

    return undefined;
  }
}

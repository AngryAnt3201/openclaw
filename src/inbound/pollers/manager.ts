// ---------------------------------------------------------------------------
// Poller Manager — orchestrates lifecycle of all inbound channel pollers
// ---------------------------------------------------------------------------

import type { InboundService } from "../service.js";
import type { InboundChannel } from "../types.js";
import type { Poller, PollerStatus, PollerLog } from "./types.js";
import { ImapPoller, type ImapPollerConfig } from "./imap.js";
import { SlackSessionPoller, type SlackSessionPollerConfig } from "./slack-session.js";
import { WhatsAppPoller, type WhatsAppPollerConfig } from "./whatsapp.js";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface PollerManagerDeps {
  inboundService: InboundService;
  log: PollerLog;
  broadcast: (event: string, payload: unknown) => void;
  /** Resolves secrets from credential vault by account ID */
  resolveCredentials: (credentialAccountId: string) => Promise<Record<string, string>>;
  /** Optional callback when a WhatsApp channel emits a QR code */
  onWhatsAppQr?: (channelId: string, qr: string) => void;
}

// ---------------------------------------------------------------------------
// PollerManager
// ---------------------------------------------------------------------------

export class PollerManager {
  private pollers = new Map<string, Poller>();
  private readonly deps: PollerManagerDeps;

  constructor(deps: PollerManagerDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // startChannel
  // -------------------------------------------------------------------------

  async startChannel(channel: InboundChannel): Promise<void> {
    // Stop existing poller for this channel if any
    if (this.pollers.has(channel.id)) {
      await this.stopChannel(channel.id);
    }

    if (!channel.enabled) {
      this.deps.log.info(`[poller-manager] channel ${channel.id} is disabled, skipping`);
      return;
    }

    // Resolve credentials
    const credentialAccountId = (channel.config as any)?.credentialAccountId as string | undefined;
    let credentials: Record<string, string> = {};

    if (credentialAccountId) {
      try {
        credentials = await this.deps.resolveCredentials(credentialAccountId);
      } catch (err) {
        this.deps.log.error(
          `[poller-manager] credential resolution failed for channel ${channel.id}: ${String(err)}`,
        );
        await this.deps.inboundService.updateChannel(channel.id, {
          status: "error",
          errorMessage: `Credential resolution failed: ${String(err)}`,
        });
        return;
      }
    }

    // Fallback: merge inline credentials from channel.config (for direct setup without vault)
    if (channel.config) {
      for (const [k, v] of Object.entries(channel.config)) {
        if (k !== "credentialAccountId" && typeof v === "string" && !credentials[k]) {
          credentials[k] = v;
        }
      }
    }

    // Create the appropriate poller
    let poller: Poller | null = null;

    switch (channel.type) {
      case "email": {
        const config: ImapPollerConfig = {
          channelId: channel.id,
          channelName: channel.name,
          credentials,
          options: channel.config as Record<string, unknown>,
          imapHost: credentials.imapHost ?? "",
          imapUser: credentials.imapUser ?? "",
          imapPass: credentials.imapPass ?? "",
        };
        poller = new ImapPoller(config, this.deps.log);
        break;
      }

      case "slack": {
        const config: SlackSessionPollerConfig = {
          channelId: channel.id,
          channelName: channel.name,
          credentials: {
            ...credentials,
            token: credentials.token ?? "",
            cookie: credentials.cookie ?? "",
          },
          options: channel.config as SlackSessionPollerConfig["options"],
        };
        poller = new SlackSessionPoller(config, this.deps.log);
        break;
      }

      case "whatsapp": {
        const config: WhatsAppPollerConfig = {
          channelId: channel.id,
          channelName: channel.name,
          credentials,
          options: channel.config as Record<string, unknown>,
          onQr: (qr: string) => {
            this.deps.onWhatsAppQr?.(channel.id, qr);
            this.deps.broadcast("inbound.whatsapp.qr", {
              channelId: channel.id,
              qr,
            });
          },
          onStatus: (channelId: string, status: PollerStatus, error?: string) => {
            void this.onStatus(channelId, status, error);
          },
          log: this.deps.log,
        };
        poller = new WhatsAppPoller(config);
        break;
      }

      default:
        this.deps.log.info(
          `[poller-manager] no poller for channel type "${channel.type}", skipping`,
        );
        return;
    }

    // Start the poller
    this.pollers.set(channel.id, poller);

    try {
      await poller.start();
      this.deps.log.info(
        `[poller-manager] started ${channel.type} poller for channel ${channel.id}`,
      );
    } catch (err) {
      this.deps.log.error(
        `[poller-manager] failed to start poller for channel ${channel.id}: ${String(err)}`,
      );
      this.pollers.delete(channel.id);
    }
  }

  // -------------------------------------------------------------------------
  // stopChannel
  // -------------------------------------------------------------------------

  async stopChannel(channelId: string): Promise<void> {
    const poller = this.pollers.get(channelId);
    if (!poller) {
      return;
    }

    try {
      await poller.stop();
    } catch (err) {
      this.deps.log.error(
        `[poller-manager] error stopping poller for channel ${channelId}: ${String(err)}`,
      );
    }

    this.pollers.delete(channelId);
    this.deps.log.info(`[poller-manager] stopped poller for channel ${channelId}`);
  }

  // -------------------------------------------------------------------------
  // startAll
  // -------------------------------------------------------------------------

  async startAll(channels: InboundChannel[]): Promise<void> {
    const enabled = channels.filter((ch) => ch.enabled);
    this.deps.log.info(
      `[poller-manager] starting pollers for ${enabled.length} enabled channel(s)`,
    );

    for (const channel of enabled) {
      try {
        await this.startChannel(channel);
      } catch (err) {
        this.deps.log.error(
          `[poller-manager] failed to start channel ${channel.id}: ${String(err)}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // stopAll
  // -------------------------------------------------------------------------

  async stopAll(): Promise<void> {
    const ids = [...this.pollers.keys()];
    this.deps.log.info(`[poller-manager] stopping ${ids.length} poller(s)`);

    const results = await Promise.allSettled(ids.map((id) => this.stopChannel(id)));

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "rejected") {
        this.deps.log.error(
          `[poller-manager] error stopping channel ${ids[i]}: ${String(result.reason)}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // handleChannelEvent
  // -------------------------------------------------------------------------

  handleChannelEvent(event: string, channel: InboundChannel): void {
    switch (event) {
      case "inbound.channel.added":
        if (channel.enabled) {
          void this.startChannel(channel);
        }
        break;

      case "inbound.channel.updated":
        if (channel.enabled) {
          // Restart to pick up config changes
          void this.startChannel(channel);
        } else {
          void this.stopChannel(channel.id);
        }
        break;

      case "inbound.channel.removed":
        void this.stopChannel(channel.id);
        break;
    }
  }

  // -------------------------------------------------------------------------
  // getPollerStatuses
  // -------------------------------------------------------------------------

  getPollerStatuses(): Map<string, PollerStatus> {
    const statuses = new Map<string, PollerStatus>();
    for (const [id, poller] of this.pollers) {
      statuses.set(id, poller.status());
    }
    return statuses;
  }

  // -------------------------------------------------------------------------
  // Private: onStatus callback
  // -------------------------------------------------------------------------

  private async onStatus(channelId: string, status: PollerStatus, error?: string): Promise<void> {
    const channelStatus = this.mapPollerStatus(status);

    try {
      await this.deps.inboundService.updateChannel(channelId, {
        status: channelStatus,
        errorMessage: error,
      });
    } catch (err) {
      this.deps.log.error(
        `[poller-manager] failed to update channel status for ${channelId}: ${String(err)}`,
      );
    }

    this.deps.broadcast("inbound.channel.status", {
      channelId,
      status: channelStatus,
      error,
    });
  }

  // -------------------------------------------------------------------------
  // Private: mapPollerStatus
  // -------------------------------------------------------------------------

  private mapPollerStatus(s: PollerStatus): InboundChannel["status"] {
    switch (s) {
      case "idle":
        return "disconnected";
      case "connecting":
        return "connecting";
      case "connected":
        return "connected";
      case "syncing":
        return "syncing";
      case "disconnected":
        return "disconnected";
      case "error":
        return "error";
    }
  }
}

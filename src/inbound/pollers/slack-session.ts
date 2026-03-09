// ---------------------------------------------------------------------------
// Slack Session Poller — polls Slack via xoxc- session token + d cookie
// ---------------------------------------------------------------------------

import { WebClient } from "@slack/web-api";
import type { Poller, PollerConfig, PollerStatus, PollerLog } from "./types.js";
import { forwardToInbound, normalizeSlackMessage } from "../bridge.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SlackSessionPollerConfig extends PollerConfig {
  /** xoxc- session token */
  credentials: Record<string, string> & {
    token: string;
    cookie: string;
  };
  options?: {
    /** Specific Slack channel IDs to poll. If omitted, discovers all joined channels. */
    slackChannelIds?: string[];
    /** Poll interval in ms (default 15 000) */
    pollIntervalMs?: number;
    /** If true, backfill all available history on first connect (default false) */
    backfill?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const RATE_LIMIT_BACKOFF_MS = 5_000;
const HISTORY_LIMIT = 50;
const CHANNEL_LIST_LIMIT = 200;

// ---------------------------------------------------------------------------
// SlackSessionPoller
// ---------------------------------------------------------------------------

export class SlackSessionPoller implements Poller {
  readonly channelId: string;

  private readonly config: SlackSessionPollerConfig;
  private readonly log: PollerLog;
  private client: WebClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private _status: PollerStatus = "idle";
  private stopped = false;

  /** Per-Slack-channel: the latest `ts` we have already seen */
  private latestTs = new Map<string, string>();
  /** Cached Slack channel ID -> name mapping */
  private channelNames = new Map<string, string>();
  /** Resolved list of Slack channel IDs to poll */
  private targetChannels: string[] = [];
  /** Our own Slack user/bot id (from auth.test) so we can optionally skip self */
  private selfUserId: string | undefined;
  /** Whether initial backfill has been completed */
  private backfillDone = false;

  constructor(config: SlackSessionPollerConfig, log: PollerLog) {
    this.channelId = config.channelId;
    this.config = config;
    this.log = log;
  }

  // -----------------------------------------------------------------------
  // Poller interface
  // -----------------------------------------------------------------------

  status(): PollerStatus {
    return this._status;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this._status = "connecting";

    const { token, cookie } = this.config.credentials;
    if (!token || !cookie) {
      this._status = "error";
      throw new Error("slack-session: missing token or cookie in credentials");
    }

    this.client = new WebClient(token, {
      headers: { cookie: `d=${cookie}` },
    });

    // Verify credentials
    try {
      const auth = await this.client.auth.test();
      this.selfUserId = auth.user_id as string | undefined;
      this.log.info(
        `slack-session: authenticated as ${auth.user ?? auth.user_id} (team: ${auth.team ?? auth.team_id})`,
      );
    } catch (err) {
      this._status = "error";
      throw new Error(`slack-session: auth.test failed — ${String(err)}`, { cause: err });
    }

    // Resolve target channels
    const explicitIds = this.config.options?.slackChannelIds;
    if (explicitIds && explicitIds.length > 0) {
      this.targetChannels = explicitIds;
    } else {
      this.targetChannels = await this.discoverJoinedChannels();
    }

    if (this.targetChannels.length === 0) {
      this.log.warn(
        "slack-session: no channels to poll — is the account a member of any channels?",
      );
    } else {
      this.log.info(`slack-session: polling ${this.targetChannels.length} channel(s)`);
    }

    // Pre-resolve channel names
    await this.resolveChannelNames(this.targetChannels);

    this._status = "connected";

    // Backfill history if requested
    if (this.config.options?.backfill && !this.backfillDone) {
      this._status = "syncing";
      this.log.info("slack-session: starting history backfill...");
      await this.backfillAll();
      this.backfillDone = true;
      this.log.info("slack-session: backfill complete");
      this._status = "connected";
    }

    // Start polling loop
    const intervalMs = this.config.options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);

    // Immediately do the first poll
    void this.pollOnce();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.client = null;
    this._status = "disconnected";
    this.log.info("slack-session: stopped");
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async discoverJoinedChannels(): Promise<string[]> {
    if (!this.client) {
      return [];
    }
    const ids: string[] = [];
    try {
      let cursor: string | undefined;
      do {
        const res = await this.client.conversations.list({
          types: "public_channel,private_channel,mpim,im",
          limit: CHANNEL_LIST_LIMIT,
          cursor,
        });
        for (const ch of res.channels ?? []) {
          if (ch.is_member && ch.id) {
            ids.push(ch.id);
          }
        }
        cursor = res.response_metadata?.next_cursor || undefined;
      } while (cursor);
    } catch (err) {
      this.log.error(`slack-session: failed to discover channels — ${String(err)}`);
    }
    return ids;
  }

  private async resolveChannelNames(channelIds: string[]): Promise<void> {
    if (!this.client) {
      return;
    }
    for (const id of channelIds) {
      if (this.channelNames.has(id)) {
        continue;
      }
      try {
        const info = await this.client.conversations.info({ channel: id });
        const name = (info.channel as Record<string, unknown>)?.name as string | undefined;
        if (name) {
          this.channelNames.set(id, name);
        }
      } catch {
        // Ignore — we'll fall back to the channel ID
      }
    }
  }

  /**
   * Backfill all available history for every target channel.
   * Paginates through conversations.history until no more messages.
   */
  private async backfillAll(): Promise<void> {
    if (!this.client || this.stopped) {
      return;
    }

    let totalIngested = 0;

    for (const slackChannelId of this.targetChannels) {
      if (this.stopped) {
        break;
      }

      const channelName = this.channelNames.get(slackChannelId) ?? slackChannelId;
      this.log.info(`slack-session: backfilling #${channelName}...`);

      let cursor: string | undefined;
      let channelCount = 0;
      let maxTs = "0";

      try {
        do {
          if (this.stopped) {
            break;
          }

          const params: Record<string, unknown> = {
            channel: slackChannelId,
            limit: 200, // max per page
          };
          if (cursor) {
            params.cursor = cursor;
          }

          const res = await this.client!.conversations.history(
            params as unknown as Parameters<WebClient["conversations"]["history"]>[0],
          );

          const messages = res.messages ?? [];
          if (messages.length === 0) {
            break;
          }

          for (const msg of messages) {
            const ts = msg.ts as string | undefined;
            if (!ts) {
              continue;
            }
            if (msg.bot_id) {
              continue;
            }
            if (msg.subtype && msg.subtype !== "file_share" && msg.subtype !== "thread_broadcast") {
              continue;
            }

            if (ts > maxTs) {
              maxTs = ts;
            }

            const files =
              (msg.files as Array<{
                id: string;
                name: string;
                mimetype?: string;
                url_private?: string;
                size?: number;
              }>) ?? undefined;

            const raw = normalizeSlackMessage({
              messageTs: ts,
              text: (msg.text as string) ?? "",
              channelId: slackChannelId,
              channelName,
              userId: msg.user as string | undefined,
              username: msg.user as string | undefined,
              threadTs: msg.thread_ts as string | undefined,
              accountId: this.config.credentials.accountId,
              files: files && files.length > 0 ? files : undefined,
            });

            forwardToInbound(raw);
            channelCount++;
          }

          cursor = res.response_metadata?.next_cursor || undefined;

          // Rate limit respect: small delay between pages
          if (cursor) {
            await this.sleep(500);
          }
        } while (cursor);
      } catch (err) {
        if (this.isRateLimited(err)) {
          this.log.warn(
            `slack-session: rate limited during backfill of #${channelName}, pausing 10s`,
          );
          await this.sleep(10_000);
        } else {
          this.log.error(`slack-session: backfill error on #${channelName} — ${String(err)}`);
        }
      }

      if (maxTs !== "0") {
        this.latestTs.set(slackChannelId, maxTs);
      }

      totalIngested += channelCount;
      this.log.info(`slack-session: backfilled ${channelCount} messages from #${channelName}`);
    }

    this.log.info(`slack-session: backfill complete — ${totalIngested} total messages ingested`);
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped || !this.client) {
      return;
    }
    this._status = "syncing";

    for (const slackChannelId of this.targetChannels) {
      if (this.stopped) {
        break;
      }
      try {
        await this.pollChannel(slackChannelId);
      } catch (err: unknown) {
        if (this.isRateLimited(err)) {
          this.log.warn(
            `slack-session: rate limited on ${slackChannelId}, backing off ${RATE_LIMIT_BACKOFF_MS}ms`,
          );
          await this.sleep(RATE_LIMIT_BACKOFF_MS);
        } else {
          this.log.error(`slack-session: error polling ${slackChannelId} — ${String(err)}`);
        }
      }
    }

    if (!this.stopped) {
      this._status = "connected";
    }
  }

  private async pollChannel(slackChannelId: string): Promise<void> {
    if (!this.client) {
      return;
    }

    const oldest = this.latestTs.get(slackChannelId);
    const params: Record<string, unknown> = {
      channel: slackChannelId,
      limit: HISTORY_LIMIT,
    };
    if (oldest) {
      params.oldest = oldest;
    }

    const res = await this.client.conversations.history(
      params as unknown as Parameters<WebClient["conversations"]["history"]>[0],
    );
    const messages = res.messages ?? [];

    if (messages.length === 0) {
      return;
    }

    // Messages come newest-first — track max ts
    let maxTs = oldest ?? "0";

    for (const msg of messages) {
      const ts = msg.ts as string | undefined;
      if (!ts) {
        continue;
      }

      // Skip the boundary message we've already seen
      if (oldest && ts === oldest) {
        continue;
      }

      // Skip bot messages
      if (msg.bot_id) {
        continue;
      }

      // Skip subtypes that aren't real user messages (joins, topic changes, etc.)
      if (msg.subtype && msg.subtype !== "file_share" && msg.subtype !== "thread_broadcast") {
        continue;
      }

      // Track the highest ts
      if (ts > maxTs) {
        maxTs = ts;
      }

      const channelName = this.channelNames.get(slackChannelId);
      const files =
        (msg.files as Array<{
          id: string;
          name: string;
          mimetype?: string;
          url_private?: string;
          size?: number;
        }>) ?? undefined;

      const raw = normalizeSlackMessage({
        messageTs: ts,
        text: (msg.text as string) ?? "",
        channelId: slackChannelId,
        channelName,
        userId: msg.user as string | undefined,
        username: msg.user as string | undefined,
        threadTs: msg.thread_ts as string | undefined,
        accountId: this.config.credentials.accountId,
        files: files && files.length > 0 ? files : undefined,
      });

      forwardToInbound(raw);
    }

    if (maxTs > (oldest ?? "0")) {
      this.latestTs.set(slackChannelId, maxTs);
    }
  }

  private isRateLimited(err: unknown): boolean {
    if (err && typeof err === "object") {
      const e = err as Record<string, unknown>;
      if (e.code === "slack_webapi_rate_limited_error") {
        return true;
      }
      if (typeof e.message === "string" && e.message.includes("ratelimited")) {
        return true;
      }
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

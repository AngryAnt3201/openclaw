// ---------------------------------------------------------------------------
// Slack Session Poller — polls Slack via xoxc- session token + d cookie
// ---------------------------------------------------------------------------

import { WebClient } from "@slack/web-api";
import type { InboundMention } from "../types.js";
import type { Poller, PollerConfig, PollerStatus, PollerLog } from "./types.js";
import { forwardToInbound, normalizeSlackMessage } from "../bridge.js";

// ---------------------------------------------------------------------------
// Mention extraction types
// ---------------------------------------------------------------------------

interface ExtractedMention {
  rawMatch: string;
  id: string;
  type: "user" | "channel" | "group";
  /** Pre-extracted label from Slack markup (channel/group names) */
  label?: string;
}

// ---------------------------------------------------------------------------
// extractMentions – Scan Slack mrkdwn for user, channel, and group mentions
// ---------------------------------------------------------------------------

export function extractMentions(body: string): ExtractedMention[] {
  const mentions: ExtractedMention[] = [];
  const seen = new Set<string>();

  // User mentions: <@U0AHCEM322K>
  const userRe = /<@(U\w+)>/g;
  let match: RegExpExecArray | null;
  while ((match = userRe.exec(body)) !== null) {
    const key = `user:${match[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      mentions.push({ rawMatch: match[0], id: match[1]!, type: "user" });
    }
  }

  // Channel mentions: <#C0AHCEM322K|channel-name>
  const channelRe = /<#(C\w+)\|([^>]+)>/g;
  while ((match = channelRe.exec(body)) !== null) {
    const key = `channel:${match[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      mentions.push({
        rawMatch: match[0],
        id: match[1]!,
        type: "channel",
        label: match[2],
      });
    }
  }

  // User group mentions: <!subteam^S0AHCEM322K|@group-name>
  const groupRe = /<!subteam\^(S\w+)\|@([^>]+)>/g;
  while ((match = groupRe.exec(body)) !== null) {
    const key = `group:${match[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      mentions.push({
        rawMatch: match[0],
        id: match[1]!,
        type: "group",
        label: match[2],
      });
    }
  }

  return mentions;
}

// ---------------------------------------------------------------------------
// resolveMentions – Resolve extracted mentions to InboundMention[]
// ---------------------------------------------------------------------------

export async function resolveMentions(
  extracted: ExtractedMention[],
  resolveUser: (userId: string) => Promise<{ displayName: string; avatarUrl: string } | undefined>,
): Promise<InboundMention[]> {
  const resolved: InboundMention[] = [];

  for (const m of extracted) {
    switch (m.type) {
      case "user": {
        const profile = await resolveUser(m.id);
        resolved.push({
          id: m.id,
          name: profile?.displayName ?? m.id,
          avatar: profile?.avatarUrl || undefined,
          type: "user",
        });
        break;
      }
      case "channel": {
        resolved.push({
          id: m.id,
          name: m.label ?? m.id,
          type: "channel",
        });
        break;
      }
      case "group": {
        resolved.push({
          id: m.id,
          name: m.label ?? m.id,
          type: "group",
        });
        break;
      }
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// generateBodyResolved – Replace Slack markup with display names in plain text
// ---------------------------------------------------------------------------

export function generateBodyResolved(body: string, mentions: InboundMention[]): string {
  let result = body;

  // Build lookup maps for fast replacement
  const userMap = new Map<string, string>();
  const channelMap = new Map<string, string>();
  const groupMap = new Map<string, string>();

  for (const m of mentions) {
    switch (m.type) {
      case "user":
        userMap.set(m.id, m.name);
        break;
      case "channel":
        channelMap.set(m.id, m.name);
        break;
      case "group":
        groupMap.set(m.id, m.name);
        break;
    }
  }

  // Replace user mentions: <@U123> → @DisplayName
  result = result.replace(/<@(U\w+)>/g, (_match, userId: string) => {
    return `@${userMap.get(userId) ?? userId}`;
  });

  // Replace channel mentions: <#C123|name> → #name
  result = result.replace(/<#C\w+\|([^>]+)>/g, (_match, name: string) => {
    return `#${name}`;
  });

  // Replace user group mentions: <!subteam^S123|@name> → @name
  result = result.replace(/<!subteam\^S\w+\|@([^>]+)>/g, (_match, name: string) => {
    return `@${name}`;
  });

  // Replace URL labels: <url|label> → label
  result = result.replace(
    /<(https?:\/\/[^|>]+)\|([^>]+)>/g,
    (_match, _url: string, label: string) => {
      return label;
    },
  );

  // Replace bare URLs: <url> → url (remove angle brackets)
  result = result.replace(/<(https?:\/\/[^>]+)>/g, (_match, url: string) => {
    return url;
  });

  // Replace special Slack markup: <!here>, <!channel>, <!everyone>
  result = result.replace(/<!here\|?[^>]*>/g, "@here");
  result = result.replace(/<!channel\|?[^>]*>/g, "@channel");
  result = result.replace(/<!everyone\|?[^>]*>/g, "@everyone");

  return result;
}

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
  /** Cached Slack user ID -> profile (display name + avatar) */
  private userProfiles = new Map<string, { displayName: string; avatarUrl: string }>();
  /** Workspace metadata (fetched once via team.info) */
  private workspaceMeta: { name: string; icon?: string } | null = null;
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

    // Fetch workspace metadata (name + icon)
    await this.resolveWorkspaceMeta();

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

  private async resolveUserProfile(
    userId: string,
  ): Promise<{ displayName: string; avatarUrl: string } | undefined> {
    if (!this.client || !userId) {
      return undefined;
    }

    const cached = this.userProfiles.get(userId);
    if (cached) {
      return cached;
    }

    try {
      const res = await this.client.users.info({ user: userId });
      const user = res.user as Record<string, unknown> | undefined;
      if (!user) {
        return undefined;
      }

      const profile = user.profile as Record<string, unknown> | undefined;
      const displayName =
        (profile?.display_name as string) ||
        (profile?.real_name as string) ||
        (user.name as string) ||
        userId;
      const avatarUrl = (profile?.image_72 as string) || (profile?.image_48 as string) || "";

      const entry = { displayName, avatarUrl };
      this.userProfiles.set(userId, entry);
      return entry;
    } catch {
      return undefined;
    }
  }

  private async resolveWorkspaceMeta(): Promise<void> {
    if (!this.client || this.workspaceMeta) {
      return;
    }

    try {
      const res = await this.client.team.info();
      const team = res.team as Record<string, unknown> | undefined;
      if (!team) {
        return;
      }

      const icon = team.icon as Record<string, unknown> | undefined;
      this.workspaceMeta = {
        name: (team.name as string) ?? this.config.channelName,
        icon: (icon?.image_88 as string) || (icon?.image_68 as string) || undefined,
      };
    } catch {
      // Non-critical — fall back to channel name
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

            const userProfile = await this.resolveUserProfile(msg.user as string);

            // Extract and resolve mentions in the message body
            const messageText = (msg.text as string) ?? "";
            const extracted = extractMentions(messageText);
            const mentions = await resolveMentions(extracted, (uid) =>
              this.resolveUserProfile(uid),
            );
            const bodyResolved = generateBodyResolved(messageText, mentions);

            const raw = normalizeSlackMessage({
              messageTs: ts,
              text: messageText,
              channelId: slackChannelId,
              channelName,
              userId: msg.user as string | undefined,
              username: msg.user as string | undefined,
              threadTs: msg.thread_ts as string | undefined,
              accountId: this.config.credentials.accountId,
              files: files && files.length > 0 ? files : undefined,
              senderDisplayName: userProfile?.displayName,
              senderAvatar: userProfile?.avatarUrl,
              workspaceName: this.workspaceMeta?.name,
              workspaceIcon: this.workspaceMeta?.icon,
            });

            // Attach resolved mentions and body to the raw message
            raw.bodyResolved = bodyResolved;
            raw.mentions = mentions;

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

      const userProfile = await this.resolveUserProfile(msg.user as string);

      // Extract and resolve mentions in the message body
      const messageText = (msg.text as string) ?? "";
      const extracted = extractMentions(messageText);
      const mentions = await resolveMentions(extracted, (uid) => this.resolveUserProfile(uid));
      const bodyResolved = generateBodyResolved(messageText, mentions);

      const raw = normalizeSlackMessage({
        messageTs: ts,
        text: messageText,
        channelId: slackChannelId,
        channelName,
        userId: msg.user as string | undefined,
        username: msg.user as string | undefined,
        threadTs: msg.thread_ts as string | undefined,
        accountId: this.config.credentials.accountId,
        files: files && files.length > 0 ? files : undefined,
        senderDisplayName: userProfile?.displayName,
        senderAvatar: userProfile?.avatarUrl,
        workspaceName: this.workspaceMeta?.name,
        workspaceIcon: this.workspaceMeta?.icon,
      });

      // Attach resolved mentions and body to the raw message
      raw.bodyResolved = bodyResolved;
      raw.mentions = mentions;

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

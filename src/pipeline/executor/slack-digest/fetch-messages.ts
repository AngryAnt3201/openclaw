// ---------------------------------------------------------------------------
// Fetch-Messages Executor — Slack Digest Pipeline
// ---------------------------------------------------------------------------
// Queries the gateway for Slack inbound messages since the last pipeline run,
// groups them by channel, nests thread replies, sorts by timestamp, and
// formats the result as readable text for agent consumption.
// ---------------------------------------------------------------------------

import type { PipelineNode } from "../../types.js";
import type { ExecutorContext, NodeExecutionResult } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIPELINE_ID = "builtin:slack-digest";
const MAX_MESSAGES = 500;
const DEFAULT_LOOKBACK_MS = 12 * 60 * 60 * 1000; // 12 hours

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a single inbound message returned by the gateway. */
interface InboundMessageLike {
  id: string;
  source: {
    type: string;
    channelId: string;
    channelName?: string;
    senderId?: string;
    senderName?: string;
    platformMeta?: Record<string, unknown>;
  };
  body: string;
  createdAtMs: number;
}

/** A channel group containing root messages and their threaded replies. */
interface ChannelGroup {
  channelKey: string;
  roots: RootMessage[];
}

interface RootMessage {
  msg: InboundMessageLike;
  replies: InboundMessageLike[];
}

/** Output type returned by executeFetchMessages. */
export type FetchMessagesOutput = {
  empty: boolean;
  formatted: string;
  messageCount: number;
  channels: string[];
  windowStart: number;
  windowEnd: number;
  capped?: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the channel key (name preferred, fallback to id). */
function channelKey(msg: InboundMessageLike): string {
  return msg.source.channelName ?? msg.source.channelId;
}

/** Returns true if the message is a thread reply (messageTs !== threadTs). */
function isReply(msg: InboundMessageLike): boolean {
  const meta = msg.source.platformMeta;
  if (!meta) {
    return false;
  }
  const messageTs = meta["messageTs"];
  const threadTs = meta["threadTs"];
  if (typeof messageTs !== "string" || typeof threadTs !== "string") {
    return false;
  }
  return messageTs !== threadTs;
}

/** Returns the threadTs for a message, or null if not a reply. */
function getThreadTs(msg: InboundMessageLike): string | null {
  const meta = msg.source.platformMeta;
  if (!meta) {
    return null;
  }
  const threadTs = meta["threadTs"];
  return typeof threadTs === "string" ? threadTs : null;
}

/** Returns the messageTs for a message, or null if absent. */
function getMessageTs(msg: InboundMessageLike): string | null {
  const meta = msg.source.platformMeta;
  if (!meta) {
    return null;
  }
  const messageTs = meta["messageTs"];
  return typeof messageTs === "string" ? messageTs : null;
}

/** Formats a UTC millisecond timestamp as HH:MM:SS for display. */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Formats a single message line. */
function formatLine(msg: InboundMessageLike, indent = ""): string {
  const time = formatTime(msg.createdAtMs);
  const sender = msg.source.senderName ?? msg.source.senderId ?? "unknown";
  return `${indent}[${time}] ${sender}: ${msg.body}`;
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function executeFetchMessages(
  _node: PipelineNode,
  _input: unknown,
  context: ExecutorContext,
): Promise<NodeExecutionResult> {
  const start = Date.now();

  if (!context.callGatewayRpc) {
    return {
      status: "failure",
      error: "callGatewayRpc not available in executor context",
      durationMs: Date.now() - start,
    };
  }

  try {
    // -----------------------------------------------------------------------
    // Step 1: Determine the time window start
    // -----------------------------------------------------------------------
    let windowStart: number;

    try {
      const runsResult = (await context.callGatewayRpc("pipeline.runs", {
        id: PIPELINE_ID,
        limit: 1,
      })) as { runs: Array<{ completedAtMs: number }> };

      if (runsResult.runs.length > 0 && runsResult.runs[0].completedAtMs) {
        windowStart = runsResult.runs[0].completedAtMs;
      } else {
        windowStart = Date.now() - DEFAULT_LOOKBACK_MS;
      }
    } catch {
      // If pipeline.runs call fails, fall back to 12h lookback
      windowStart = Date.now() - DEFAULT_LOOKBACK_MS;
    }

    const windowEnd = Date.now();

    // -----------------------------------------------------------------------
    // Step 2: Fetch Slack messages since windowStart
    // -----------------------------------------------------------------------
    const listResult = (await context.callGatewayRpc("inbound.message.list", {
      sourceType: "slack",
      since: windowStart,
    })) as { messages: InboundMessageLike[] };

    let messages = listResult.messages ?? [];

    // Sort all messages by createdAtMs ascending
    messages = [...messages].toSorted((a, b) => a.createdAtMs - b.createdAtMs);

    // Cap at MAX_MESSAGES
    const capped = messages.length > MAX_MESSAGES;
    if (capped) {
      messages = messages.slice(0, MAX_MESSAGES);
    }

    if (messages.length === 0) {
      return {
        status: "success",
        output: {
          empty: true,
          formatted: "",
          messageCount: 0,
          channels: [],
          windowStart,
          windowEnd,
        } satisfies FetchMessagesOutput,
        durationMs: Date.now() - start,
      };
    }

    // -----------------------------------------------------------------------
    // Step 3: Group by channel, nest thread replies
    // -----------------------------------------------------------------------
    const channelMap = new Map<string, Map<string, RootMessage>>();

    // Index root messages by their messageTs for fast reply lookup
    // First pass: collect all root messages
    for (const msg of messages) {
      const key = channelKey(msg);
      if (!channelMap.has(key)) {
        channelMap.set(key, new Map());
      }
      const roots = channelMap.get(key)!;

      if (!isReply(msg)) {
        const mts = getMessageTs(msg) ?? msg.id;
        if (!roots.has(mts)) {
          roots.set(mts, { msg, replies: [] });
        }
      }
    }

    // Second pass: attach replies to their root
    for (const msg of messages) {
      if (!isReply(msg)) {
        continue;
      }
      const key = channelKey(msg);
      const roots = channelMap.get(key);
      if (!roots) {
        continue;
      }

      const threadTs = getThreadTs(msg);
      if (threadTs && roots.has(threadTs)) {
        roots.get(threadTs)!.replies.push(msg);
      } else {
        // Orphaned reply — treat as standalone root
        const mts = getMessageTs(msg) ?? msg.id;
        if (!roots.has(mts)) {
          roots.set(mts, { msg, replies: [] });
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 4: Format as readable text
    // -----------------------------------------------------------------------
    const channelGroups: ChannelGroup[] = Array.from(channelMap.entries()).map(
      ([key, rootsMap]) => ({
        channelKey: key,
        roots: Array.from(rootsMap.values()),
      }),
    );

    // Sort channels alphabetically for stable output
    channelGroups.sort((a, b) => a.channelKey.localeCompare(b.channelKey));

    const lines: string[] = [];
    for (const group of channelGroups) {
      lines.push(`=== #${group.channelKey} ===`);

      // Sort roots by their message createdAtMs
      const sortedRoots = [...group.roots].toSorted(
        (a, b) => a.msg.createdAtMs - b.msg.createdAtMs,
      );

      for (const root of sortedRoots) {
        lines.push(formatLine(root.msg));
        // Sort replies by createdAtMs ascending
        const sortedReplies = [...root.replies].toSorted((a, b) => a.createdAtMs - b.createdAtMs);
        for (const reply of sortedReplies) {
          lines.push(formatLine(reply, "  ↳ "));
        }
      }

      lines.push(""); // blank line between channels
    }

    const formatted = lines.join("\n").trimEnd();
    const channels = channelGroups.map((g) => g.channelKey);

    const output: FetchMessagesOutput = {
      empty: false,
      formatted,
      messageCount: messages.length,
      channels,
      windowStart,
      windowEnd,
    };
    if (capped) {
      output.capped = true;
    }

    context.log?.info(
      `[fetch-messages] Fetched ${messages.length} Slack messages across ${channels.length} channels` +
        (capped ? " (capped at 500)" : ""),
    );

    return {
      status: "success",
      output,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    context.log?.error("[fetch-messages] Failed to fetch Slack messages:", err);
    return {
      status: "failure",
      error: message,
      durationMs: Date.now() - start,
    };
  }
}

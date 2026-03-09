// ---------------------------------------------------------------------------
// Inbound Bridge – Global singleton for forwarding platform messages
// ---------------------------------------------------------------------------
// Platform monitors (Discord, Telegram, Slack) import forwardToInbound()
// and call it when messages arrive. The InboundService is injected at
// gateway startup via setInboundBridge().
// ---------------------------------------------------------------------------

import type { InboundService } from "./service.js";
import type { RawInboundMessage, InboundSourceType } from "./types.js";

let _service: InboundService | null = null;
let _log: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
} | null = null;

/**
 * Inject the InboundService at gateway startup.
 */
export function setInboundBridge(
  service: InboundService,
  log?: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
): void {
  _service = service;
  _log = log ?? null;
}

/**
 * Clear the bridge (on gateway shutdown).
 */
export function clearInboundBridge(): void {
  _service = null;
  _log = null;
}

/**
 * Check if the inbound bridge is active (service injected + channels may exist).
 */
export function isInboundBridgeActive(): boolean {
  return _service !== null;
}

/**
 * Forward a platform message to the inbound system.
 * Best-effort — never throws, never blocks the caller's pipeline.
 * Only forwards if an enabled inbound channel exists for this source type.
 */
export function forwardToInbound(raw: RawInboundMessage): void {
  if (!_service) {
    return;
  }

  // Fire-and-forget — don't await, don't block the platform handler
  void _service.ingestMessage(raw).catch((err) => {
    _log?.warn?.(`inbound bridge: failed to ingest message: ${String(err)}`);
  });
}

// ---------------------------------------------------------------------------
// Platform-specific normalizers
// ---------------------------------------------------------------------------

/**
 * Normalize a Discord message into a RawInboundMessage.
 */
export function normalizeDiscordMessage(params: {
  messageId: string;
  content: string;
  authorId: string;
  authorName: string;
  channelId: string;
  channelName?: string;
  guildName?: string;
  attachments?: Array<{
    id: string;
    filename: string;
    content_type?: string;
    url?: string;
    size?: number;
  }>;
  accountId?: string;
}): RawInboundMessage {
  return {
    source: {
      type: "discord" as InboundSourceType,
      channelId: params.channelId,
      channelName: params.channelName ?? params.channelId,
      senderId: params.authorId,
      senderName: params.authorName,
      platformMeta: {
        guildName: params.guildName,
        accountId: params.accountId,
      },
    },
    body: params.content,
    externalId: `discord:${params.messageId}`,
    attachments: params.attachments?.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.content_type ?? "application/octet-stream",
      url: a.url,
      sizeBytes: a.size,
    })),
  };
}

/**
 * Normalize a Telegram message into a RawInboundMessage.
 */
export function normalizeTelegramMessage(params: {
  messageId: number;
  text: string;
  chatId: number;
  chatType?: string;
  senderId: number;
  senderName: string;
  senderUsername?: string;
  accountId?: string;
  media?: Array<{ path: string; contentType?: string }>;
}): RawInboundMessage {
  return {
    source: {
      type: "telegram" as InboundSourceType,
      channelId: String(params.chatId),
      channelName:
        params.chatType === "private" ? `DM:${params.senderName}` : String(params.chatId),
      senderId: String(params.senderId),
      senderName: params.senderName,
      platformMeta: {
        chatType: params.chatType,
        senderUsername: params.senderUsername,
        accountId: params.accountId,
      },
    },
    body: params.text,
    externalId: `telegram:${params.chatId}:${params.messageId}`,
    attachments: params.media?.map((m, i) => ({
      id: `tg-media-${i}`,
      filename: m.path.split("/").pop() ?? `media-${i}`,
      mimeType: m.contentType ?? "application/octet-stream",
    })),
  };
}

/**
 * Normalize a Slack message into a RawInboundMessage.
 */
export function normalizeSlackMessage(params: {
  messageTs: string;
  text: string;
  channelId: string;
  channelName?: string;
  userId?: string;
  username?: string;
  botId?: string;
  threadTs?: string;
  accountId?: string;
  files?: Array<{
    id: string;
    name: string;
    mimetype?: string;
    url_private?: string;
    size?: number;
  }>;
}): RawInboundMessage {
  return {
    source: {
      type: "slack" as InboundSourceType,
      channelId: params.channelId,
      channelName: params.channelName ?? params.channelId,
      senderId: params.userId ?? params.botId,
      senderName: params.username ?? params.userId ?? params.botId ?? "unknown",
      platformMeta: {
        threadTs: params.threadTs,
        accountId: params.accountId,
      },
    },
    body: params.text,
    externalId: `slack:${params.channelId}:${params.messageTs}`,
    attachments: params.files?.map((f) => ({
      id: f.id,
      filename: f.name,
      mimeType: f.mimetype ?? "application/octet-stream",
      url: f.url_private,
      sizeBytes: f.size,
    })),
  };
}

/**
 * Normalize an email (IMAP) message into a RawInboundMessage.
 */
export function normalizeEmailMessage(params: {
  messageId: string;
  subject: string;
  body: string;
  from: string;
  fromName?: string;
  to?: string;
  date?: Date;
  channelId: string;
  attachments?: Array<{
    filename: string;
    contentType?: string;
    size?: number;
  }>;
}): RawInboundMessage {
  return {
    source: {
      type: "email" as InboundSourceType,
      channelId: params.channelId,
      channelName: params.to ?? params.channelId,
      senderId: params.from,
      senderName: params.fromName ?? params.from,
    },
    body: params.body,
    subject: params.subject,
    externalId: `email:${params.channelId}:${params.messageId}`,
    attachments: params.attachments?.map((a, i) => ({
      id: `email-att-${i}`,
      filename: a.filename,
      mimeType: a.contentType ?? "application/octet-stream",
      sizeBytes: a.size,
    })),
    metadata: {
      date: params.date?.toISOString(),
    },
  };
}

/**
 * Normalize a WhatsApp (Baileys) message into a RawInboundMessage.
 */
export function normalizeWhatsAppMessage(params: {
  messageId: string;
  body: string;
  remoteJid: string;
  senderJid?: string;
  senderName?: string;
  channelId: string;
  isGroup: boolean;
  timestamp?: number;
}): RawInboundMessage {
  return {
    source: {
      type: "whatsapp" as InboundSourceType,
      channelId: params.channelId,
      channelName: params.isGroup
        ? params.remoteJid.split("@")[0]
        : (params.senderName ?? params.remoteJid),
      senderId: params.senderJid ?? params.remoteJid,
      senderName: params.senderName ?? params.remoteJid.split("@")[0],
      platformMeta: {
        isGroup: params.isGroup,
        remoteJid: params.remoteJid,
      },
    },
    body: params.body,
    externalId: `whatsapp:${params.messageId}`,
    metadata: {
      timestamp: params.timestamp,
    },
  };
}

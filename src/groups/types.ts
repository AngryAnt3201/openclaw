import type { ChatAttachment } from "../gateway/chat-attachments.js";

// ── Const arrays (single source of truth) ───────────────────────

export const GROUP_ACTIVATION_MODES = ["always", "mention"] as const;
export const GROUP_MESSAGE_STATES = ["final", "streaming", "error"] as const;
export const GROUP_MESSAGE_ROLES = ["user", "agent"] as const;

export type GroupActivation = (typeof GROUP_ACTIVATION_MODES)[number];
export type GroupMessageState = (typeof GROUP_MESSAGE_STATES)[number];
export type GroupMessageRole = (typeof GROUP_MESSAGE_ROLES)[number];

// ── Domain types ─────────────────────────────────────────────────

export type GroupSession = {
  id: string;
  label: string;
  agents: string[];
  activation: GroupActivation;
  historyLimit: number;
  createdAt: number;
  updatedAt: number;
};

export type GroupMessage = {
  id: string;
  seq: number;
  role: GroupMessageRole;
  agentId?: string;
  agentName?: string;
  agentColor?: string;
  agentIcon?: string;
  content: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  state: GroupMessageState;
};

export type GroupTranscript = {
  groupId: string;
  messages: GroupMessage[];
  lastSeq: number;
};

// ── Store file shapes ────────────────────────────────────────────

export type GroupStoreFile = {
  version: 1;
  groups: GroupSession[];
};

// ── Input types ──────────────────────────────────────────────────

export type GroupCreateInput = {
  label: string;
  agents: string[];
  activation?: GroupActivation;
  historyLimit?: number;
};

export type GroupPatch = {
  label?: string;
  agents?: string[];
  activation?: GroupActivation;
  historyLimit?: number;
};

export type GroupSendInput = {
  groupId: string;
  message: string;
  attachments?: ChatAttachment[];
};

// ── Filter types ─────────────────────────────────────────────────

export type GroupFilter = {
  limit?: number;
};

export type TranscriptFilter = {
  limit?: number;
  afterSeq?: number;
};

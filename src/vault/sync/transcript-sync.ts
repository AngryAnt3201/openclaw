// ---------------------------------------------------------------------------
// Transcript → Vault Sync – creates vault notes from session transcripts
// ---------------------------------------------------------------------------

import type { VaultService } from "../service.js";
import { serializeFrontmatter } from "../metadata-parser.js";

const SESSION_NOTE_PREFIX = "_system/sessions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranscriptMessage = {
  role: "user" | "agent" | "system";
  content: string;
  timestamp?: number;
};

export type TranscriptToolUse = {
  tool: string;
  input?: string;
  output?: string;
  timestamp?: number;
};

export type SessionTranscript = {
  sessionId: string;
  agentId: string;
  startedAtMs: number;
  endedAtMs?: number;
  messages: TranscriptMessage[];
  toolUses?: TranscriptToolUse[];
  summary?: string;
  filesCreated?: string[];
  filesModified?: string[];
  tokenUsage?: number;
  tags?: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionNotePath(sessionId: string, date: string): string {
  const shortId = sessionId.slice(0, 8);
  return `${SESSION_NOTE_PREFIX}/SESSION-${date}-${shortId}.md`;
}

function formatDuration(startMs: number, endMs?: number): string {
  if (!endMs) {
    return "in progress";
  }
  const mins = Math.round((endMs - startMs) / 60_000);
  if (mins < 60) {
    return `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

function formatTranscriptBody(transcript: SessionTranscript): string {
  const lines: string[] = [];
  const date = new Date(transcript.startedAtMs).toISOString().slice(0, 10);
  const duration = formatDuration(transcript.startedAtMs, transcript.endedAtMs);

  lines.push(`# Session: ${date} (${duration})`);
  lines.push("");

  // Summary
  if (transcript.summary) {
    lines.push("## Summary");
    lines.push("");
    lines.push(transcript.summary);
    lines.push("");
  }

  // Conversation
  if (transcript.messages.length > 0) {
    lines.push("## Conversation");
    lines.push("");

    for (const msg of transcript.messages) {
      const label =
        msg.role === "user" ? "### User" : msg.role === "agent" ? "### Agent" : "### System";
      lines.push(label);
      lines.push(`> ${msg.content.split("\n").join("\n> ")}`);
      lines.push("");
    }
  }

  // Tool uses
  if (transcript.toolUses && transcript.toolUses.length > 0) {
    lines.push("## Tool Uses");
    lines.push("");

    for (const tool of transcript.toolUses) {
      lines.push(`- **${tool.tool}**`);
      if (tool.input) {
        lines.push(`  - Input: \`${tool.input}\``);
      }
    }
    lines.push("");
  }

  // Artifacts
  if (
    (transcript.filesCreated && transcript.filesCreated.length > 0) ||
    (transcript.filesModified && transcript.filesModified.length > 0)
  ) {
    lines.push("## Artifacts");
    lines.push("");
    if (transcript.filesCreated) {
      for (const f of transcript.filesCreated) {
        lines.push(`- Created: \`${f}\``);
      }
    }
    if (transcript.filesModified) {
      for (const f of transcript.filesModified) {
        lines.push(`- Modified: \`${f}\``);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

export async function syncTranscriptToVault(
  transcript: SessionTranscript,
  vaultService: VaultService,
): Promise<void> {
  const date = new Date(transcript.startedAtMs).toISOString().slice(0, 10);
  const notePath = sessionNotePath(transcript.sessionId, date);

  const frontmatter: Record<string, unknown> = {
    type: "session",
    sessionId: transcript.sessionId,
    agentId: transcript.agentId,
    date,
    duration: formatDuration(transcript.startedAtMs, transcript.endedAtMs),
    messageCount: transcript.messages.length,
    tags: ["session", ...(transcript.tags ?? [])],
  };

  if (transcript.tokenUsage !== undefined) {
    frontmatter.tokenUsage = transcript.tokenUsage;
  }

  const body = formatTranscriptBody(transcript);
  const content = serializeFrontmatter(frontmatter, body);

  const existing = await vaultService.get(notePath);
  if (existing) {
    await vaultService.update(notePath, { content });
  } else {
    await vaultService.create({ path: notePath, content });
  }
}

import { describe, expect, it, vi } from "vitest";
import type { VaultService } from "../service.js";
import { syncTranscriptToVault, type SessionTranscript } from "./transcript-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTranscript(overrides?: Partial<SessionTranscript>): SessionTranscript {
  return {
    sessionId: "sess-abcd-1234-5678-efgh",
    agentId: "main",
    startedAtMs: new Date("2026-02-15T10:00:00Z").getTime(),
    endedAtMs: new Date("2026-02-15T10:45:00Z").getTime(),
    messages: [
      { role: "user", content: "Set up OAuth2" },
      { role: "agent", content: "I'll implement this in several steps." },
    ],
    ...overrides,
  };
}

function mockVaultService() {
  return {
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  } as unknown as VaultService & {
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncTranscriptToVault", () => {
  it("creates a new session note when it does not exist", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue(null);

    await syncTranscriptToVault(mockTranscript(), vs);

    expect(vs.create).toHaveBeenCalledTimes(1);
    expect(vs.update).not.toHaveBeenCalled();
  });

  it("updates an existing session note", async () => {
    const vs = mockVaultService();
    vs.get.mockResolvedValue({ path: "_system/sessions/SESSION-2026-02-15-sess-abc.md" });

    await syncTranscriptToVault(mockTranscript(), vs);

    expect(vs.update).toHaveBeenCalledTimes(1);
    expect(vs.create).not.toHaveBeenCalled();
  });

  it("uses date and short session ID in note path", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(mockTranscript(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toBe("_system/sessions/SESSION-2026-02-15-sess-abc.md");
  });

  it("includes session heading with date and duration", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(mockTranscript(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("# Session: 2026-02-15 (45m)");
  });

  it("includes frontmatter with sessionId, agentId, date", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(mockTranscript(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toMatch(/^---\n/);
    expect(createCall.content).toContain("sessionId: sess-abcd-1234-5678-efgh");
    expect(createCall.content).toContain("agentId: main");
    expect(createCall.content).toContain("date: 2026-02-15");
  });

  it("includes conversation messages with role headers", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(mockTranscript(), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("### User");
    expect(createCall.content).toContain("> Set up OAuth2");
    expect(createCall.content).toContain("### Agent");
    expect(createCall.content).toContain("> I'll implement this in several steps.");
  });

  it("includes summary section when provided", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(
      mockTranscript({ summary: "Implemented OAuth2 with JWT tokens." }),
      vs,
    );

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("## Summary");
    expect(createCall.content).toContain("Implemented OAuth2 with JWT tokens.");
  });

  it("includes tool uses section when provided", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(
      mockTranscript({
        toolUses: [
          { tool: "write_file", input: "auth/service.ts" },
          { tool: "read_file", input: "package.json" },
        ],
      }),
      vs,
    );

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("## Tool Uses");
    expect(createCall.content).toContain("**write_file**");
    expect(createCall.content).toContain("`auth/service.ts`");
  });

  it("includes artifacts section with created and modified files", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(
      mockTranscript({
        filesCreated: ["auth/service.ts"],
        filesModified: ["package.json"],
      }),
      vs,
    );

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("## Artifacts");
    expect(createCall.content).toContain("Created: `auth/service.ts`");
    expect(createCall.content).toContain("Modified: `package.json`");
  });

  it("formats duration in hours when > 60 minutes", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(
      mockTranscript({
        startedAtMs: new Date("2026-02-15T08:00:00Z").getTime(),
        endedAtMs: new Date("2026-02-15T10:30:00Z").getTime(),
      }),
      vs,
    );

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("2h 30m");
  });

  it("includes tokenUsage in frontmatter when provided", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(mockTranscript({ tokenUsage: 12500 }), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("tokenUsage: 12500");
  });

  it("shows 'in progress' for sessions without endedAtMs", async () => {
    const vs = mockVaultService();

    await syncTranscriptToVault(mockTranscript({ endedAtMs: undefined }), vs);

    const createCall = vs.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("in progress");
  });
});

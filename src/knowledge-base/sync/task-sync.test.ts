import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../tasks/types.js";
import type { KBService } from "../service.js";
import { syncTaskToKB } from "./task-sync.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTask(overrides?: Partial<Task>): Task {
  return {
    id: "12345678-abcd-1234-5678-abcdef123456",
    title: "Test Task",
    description: "A test task",
    status: "in_progress",
    priority: "medium",
    type: "instruction",
    source: "user",
    agentId: "default",
    createdAtMs: 1000000,
    updatedAtMs: 2000000,
    ...overrides,
  };
}

function mockKBService() {
  return {
    create: vi.fn().mockResolvedValue({}),
    get: vi.fn().mockResolvedValue(null),
  } as unknown as KBService & {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncTaskToKB", () => {
  // -----------------------------------------------------------------------
  // 1. Creates note via upsert (create)
  // -----------------------------------------------------------------------

  it("creates a note via upsert", async () => {
    const svc = mockKBService();

    await syncTaskToKB(mockTask(), svc);

    expect(svc.create).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 2. Note path uses first 8 chars of ID with _miranda prefix
  // -----------------------------------------------------------------------

  it("uses the first 8 characters of the task ID in the note path", async () => {
    const svc = mockKBService();

    await syncTaskToKB(mockTask(), svc);

    const createCall = svc.create.mock.calls[0]![0] as { path: string };
    expect(createCall.path).toBe("_miranda/tasks/TASK-12345678.md");
  });

  // -----------------------------------------------------------------------
  // 3. Content includes task title as heading
  // -----------------------------------------------------------------------

  it("includes the task title as a top-level heading", async () => {
    const svc = mockKBService();

    await syncTaskToKB(mockTask({ title: "Deploy Widget" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    expect(createCall.content).toContain("# Deploy Widget");
  });

  // -----------------------------------------------------------------------
  // 4. Content includes status, priority, type
  // -----------------------------------------------------------------------

  it("includes status, priority, and type in the body", async () => {
    const svc = mockKBService();

    await syncTaskToKB(
      mockTask({ status: "in_progress", priority: "high", type: "workflow" }),
      svc,
    );

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("**Status:** in progress");
    expect(content).toContain("**Priority:** high");
    expect(content).toContain("**Type:** workflow");
  });

  // -----------------------------------------------------------------------
  // 5. Frontmatter includes taskId, status, priority
  // -----------------------------------------------------------------------

  it("includes taskId, status, and priority in the frontmatter", async () => {
    const svc = mockKBService();

    await syncTaskToKB(mockTask(), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;

    // The content should start with YAML frontmatter
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("taskId: 12345678-abcd-1234-5678-abcdef123456");
    expect(content).toContain("status: in_progress");
    expect(content).toContain("priority: medium");
  });

  // -----------------------------------------------------------------------
  // 6. Handles task with result
  // -----------------------------------------------------------------------

  it("includes result section when task has a result", async () => {
    const svc = mockKBService();

    await syncTaskToKB(
      mockTask({
        result: { success: true, summary: "Completed successfully" },
      }),
      svc,
    );

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("## Result");
    expect(content).toContain("**Success:** true");
    expect(content).toContain("**Summary:** Completed successfully");
  });

  // -----------------------------------------------------------------------
  // 7. Handles task with progress
  // -----------------------------------------------------------------------

  it("includes progress when task has a progress value", async () => {
    const svc = mockKBService();

    await syncTaskToKB(mockTask({ progress: 75, progressMessage: "Almost done" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("**Progress:** 75%");
    expect(content).toContain("**Message:** Almost done");
  });

  // -----------------------------------------------------------------------
  // 8. Frontmatter tags include status and priority
  // -----------------------------------------------------------------------

  it("includes status and priority tags in frontmatter", async () => {
    const svc = mockKBService();

    await syncTaskToKB(mockTask({ status: "complete", priority: "high" }), svc);

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("task");
    expect(content).toContain("status/complete");
    expect(content).toContain("priority/high");
  });

  // -----------------------------------------------------------------------
  // 9. Description is included in body
  // -----------------------------------------------------------------------

  it("includes the task description in the body", async () => {
    const svc = mockKBService();

    await syncTaskToKB(
      mockTask({ description: "This is a detailed description of the task." }),
      svc,
    );

    const createCall = svc.create.mock.calls[0]![0] as { content: string };
    const content = createCall.content;
    expect(content).toContain("This is a detailed description of the task.");
  });
});
